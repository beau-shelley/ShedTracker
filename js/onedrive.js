// OneDrive backup over the Microsoft Graph API, using OAuth2 with PKCE so no
// client secret ever lives in this (public) code.
//
// By default everything is written into the app's own folder in your OneDrive:
//     OneDrive / Apps / Shed Tracker /
//         shedtracker.json      the index: boxes, contents, locations
//         photos/               one JPEG per photo, named box-0012-<id>.jpg
//
// You can instead point it at any folder you already have, by pasting that
// folder's OneDrive share link into Settings. That needs the broader
// Files.ReadWrite permission (read/write to your own files), since a link can
// point anywhere in your OneDrive rather than just the app's sandboxed folder.

import * as db from './db.js';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'Files.ReadWrite offline_access User.Read';
const INDEX_FILE = 'shedtracker.json';

export const redirectUri = () => location.origin + location.pathname;

export const getClientId = () => db.getMeta('msClientId', '');
export const setClientId = (id) => db.setMeta('msClientId', String(id || '').trim());

// ------------------------------------------------------------ PKCE
function randomString(len = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map(b => ('0' + b.toString(16)).slice(-2)).join('').slice(0, len);
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signIn() {
  const clientId = await getClientId();
  if (!clientId) throw new Error('Add your Application (client) ID in Settings first');

  const verifier = randomString(96);
  const state = randomString(16);
  sessionStorage.setItem('mt_pkce', verifier);
  sessionStorage.setItem('mt_state', state);
  sessionStorage.setItem('mt_return', location.hash || '#/settings');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256'
  });
  location.assign(AUTH + '?' + params);
}

// Called on every page load; completes the round trip if we came back from Microsoft.
export async function handleRedirect() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) return null;

  const state = url.searchParams.get('state');
  const expectedState = sessionStorage.getItem('mt_state');
  const returnTo = sessionStorage.getItem('mt_return') || '#/settings';
  const verifier = sessionStorage.getItem('mt_pkce');
  history.replaceState(null, '', redirectUri() + returnTo);
  sessionStorage.removeItem('mt_pkce');
  sessionStorage.removeItem('mt_state');

  if (error) throw new Error(url.searchParams.get('error_description') || error);
  if (expectedState && state !== expectedState) {
    throw new Error('Sign-in state mismatch, please try again');
  }
  if (!verifier) throw new Error('Sign-in could not be completed, please try again');

  const clientId = await getClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier
  });
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || 'Sign-in failed');
  await storeToken(json);
  return await whoAmI();
}

async function storeToken(json) {
  const existing = (await db.getMeta('msToken')) || {};
  await db.setMeta('msToken', {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || existing.refreshToken,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000 - 60000
  });
}

export async function signOut() {
  await db.delMeta('msToken');
  await db.delMeta('msAccount');
}

export async function isSignedIn() {
  const t = await db.getMeta('msToken');
  return !!(t && t.refreshToken);
}

async function accessToken() {
  const t = await db.getMeta('msToken');
  if (!t) throw new Error('Not signed in to OneDrive');
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) throw new Error('OneDrive session expired, please sign in again');

  const clientId = await getClientId();
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: t.refreshToken,
      scope: SCOPES
    })
  });
  const json = await res.json();
  if (!res.ok) {
    await db.delMeta('msToken');
    throw new Error('OneDrive session expired, please sign in again');
  }
  await storeToken(json);
  return json.access_token;
}

async function graph(path, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const token = await accessToken();
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...headers },
    body
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error.message; } catch (_) { /* keep statusText */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export async function whoAmI() {
  const me = await graph('/me');
  const account = { name: me.displayName, email: me.userPrincipalName || me.mail };
  await db.setMeta('msAccount', account);
  return account;
}

export const account = () => db.getMeta('msAccount');

const encode = (name) => name.split('/').map(encodeURIComponent).join('/');

// ------------------------------------------------------- backup location
// Defaults to the app's own sandboxed special folder. If the user has linked
// a folder of their own (see setFolderLink), everything below addresses that
// folder by drive + item id instead.
async function basePath() {
  const folder = await db.getMeta('msFolder');
  return folder && folder.driveId && folder.itemId
    ? `/drives/${folder.driveId}/items/${folder.itemId}`
    : '/me/drive/special/approot';
}

export const getFolderLink = () => db.getMeta('msFolder', null);
export const clearFolderLink = () => db.delMeta('msFolder');

// Turns a OneDrive "share" link (the kind Copy Link gives you, e.g. 1drv.ms/...)
// into the driveId + itemId Graph needs to address that folder directly.
// See: https://learn.microsoft.com/graph/api/shares-get
function encodeShareUrl(url) {
  const base64 = btoa(unescape(encodeURIComponent(url.trim())));
  return 'u!' + base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

export async function setFolderLink(url) {
  const token = encodeShareUrl(url);
  let item;
  try {
    item = await graph(`/shares/${token}/driveItem?$select=id,name,folder,parentReference,webUrl`);
  } catch (e) {
    if (e.status === 403) throw new Error('OneDrive refused that folder — sign out and sign in again to grant the new permission, then retry');
    throw e;
  }
  if (!item.folder) throw new Error('That link is not a folder');
  const info = { driveId: item.parentReference.driveId, itemId: item.id, name: item.name, webUrl: item.webUrl };
  await db.setMeta('msFolder', info);
  return info;
}

// --------------------------------------------------------------- files
export async function uploadFile(name, blob, contentType) {
  const base = await basePath();
  return graph(base + ':/' + encode(name) + ':/content', {
    method: 'PUT',
    headers: { 'Content-Type': contentType || blob.type || 'application/octet-stream' },
    body: blob
  });
}

export async function downloadFile(name) {
  try {
    const base = await basePath();
    return await graph(base + ':/' + encode(name) + ':/content', { raw: true });
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function listFolder(folder) {
  const out = [];
  const base = await basePath();
  let url = base + ':/' + encode(folder) + ':/children?$top=200&$select=id,name,size';
  try {
    while (url) {
      const page = await graph(url);
      out.push(...(page.value || []));
      url = page['@odata.nextLink'] || null;
    }
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
  return out;
}

export const photoName = (box, photo) =>
  'photos/box-' + String(box ? box.number : 0).padStart(4, '0') + '-' + photo.id + '.jpg';

export const putIndex = (snapshot) =>
  uploadFile(INDEX_FILE,
    new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    'application/json');

export async function getIndex() {
  const res = await downloadFile(INDEX_FILE);
  return res ? res.json() : null;
}

export async function quota() {
  const d = await graph('/me/drive?$select=quota');
  return d.quota || null;
}
