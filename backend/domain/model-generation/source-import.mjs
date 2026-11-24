import { resolvePublic, pinnedHttpsRequest } from '../../providers/ai/transport.mjs';
import { generationError, validateImage } from './schema.mjs';

const ORIGIN = 'https://vr.shinewonder.com';
const CDN = 'https://vr-img-cdn.shinewonder.com';
const fail = message => { throw generationError(400, message); };
export function shareToken(value) {
  let url; try { url = new URL(value); } catch { fail('请粘贴炫云网页分享链接，或改为上传房间参考图'); }
  if (url.origin !== ORIGIN || !/^\/pano\/page\/publik\/(pklimit|panocheck|mobilecheckpage)$/.test(url.pathname) || url.username || url.password) fail('目前支持炫云网页分享链接，也可以上传房间参考图');
  const inf = url.searchParams.get('inf');
  if (!inf || !/^[a-zA-Z0-9@_=+\-]{1,512}$/.test(inf)) fail('全景链接缺少有效的分享标识');
  return inf;
}
function imageUrl(value, width) {
  let url; try { url = new URL(value.replace(/^%BASEDIR%\/?/, CDN + '/')); } catch { fail('素材中的图片地址无效'); }
  if (url.hostname !== new URL(CDN).hostname || !['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password || !/^\/pano\/pano_store\/[a-zA-Z0-9_/.\-]+\.jpg$/.test(url.pathname) || /\.\./.test(url.pathname)) fail('素材图片地址不受支持，请改为上传参考图');
  url.protocol = 'https:'; url.search = ''; url.hash = '';
  url.searchParams.set('x-oss-process', `image/resize,w_${width}`);
  return url;
}
const xmlText = value => value.replace(/&(?:amp|quot|apos|lt|gt);/g, entity => ({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'})[entity]);
const attribute = (text, key) => xmlText(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i').exec(text)?.[1] ?? '');
export function sceneDescriptors(info, xml) {
  if (!info || info.needPassword === true || Number(info.needPassword) === 2 || !Array.isArray(info.vtProject)) fail('作品需要额外访问权限，请使用可公开查看的分享链接或上传参考图');
  if (typeof xml !== 'string' || xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail('全景场景清单不受支持');
  const panoramas = info.vtProject.flatMap(project => Array.isArray(project.panoList) ? project.panoList : []);
  if (!panoramas.length || panoramas.length > 12) fail('每次可导入 1–12 个全景视点；请拆分作品或上传所需房间参考图');
  const cubes = new Map();
  for (const match of xml.matchAll(/<scene\b([^>]*)>([\s\S]*?)<\/scene>/gi)) {
    const id = /^s_(\d+)$/.exec(attribute(match[1], 'name'))?.[1];
    const cube = /<cube\b([^>]*)\/?\s*>/i.exec(match[2]);
    if (id && cube) cubes.set(id, attribute(cube[1], 'url'));
  }
  const ids = new Set();
  return panoramas.map(pano => {
    const id = String(pano.pid);
    if (!/^\d{1,20}$/.test(id) || ids.has(id)) fail('全景场景标识无效或重复');
    ids.add(id);
    const cube = cubes.get(id);
    const faces = cube && cube.includes('%s') ? ['r','l','u','d','f','b'].map(face => imageUrl(cube.replace('%s', face), 1024)) : undefined;
    return { id, name: String(pano.title || '房间').slice(0, 80), thumbnail: imageUrl(String(pano.thumburl || ''), 768), faces };
  });
}

/** Read only public image metadata; never execute or distribute the third-party player. */
export async function importPanoramaSource(value, { signal, resolve, transport = pinnedHttpsRequest } = {}) {
  const token = shareToken(value);
  const timeout = AbortSignal.timeout(120000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let downloaded = 0;
  async function read(url, form, maxBytes = 2 * 1024 * 1024) {
    const perRequest = AbortSignal.any([combined, AbortSignal.timeout(20000)]);
    const addresses = await resolvePublic(url, { resolve, signal: perRequest });
    const body = form ? Buffer.from(new URLSearchParams(form).toString()) : undefined;
    const response = await transport({ url, addresses, method: body ? 'POST' : 'GET', headers: {'User-Agent':'HomeOS-PanoramaImporter/1.0', ...(body ? {'Content-Type':'application/x-www-form-urlencoded','Content-Length':String(body.length)} : {})}, body, signal: perRequest, maxBytes });
    if (response.status !== 200 || !Buffer.isBuffer(response.body) || response.body.length > maxBytes) fail('全景素材读取失败，请检查分享权限或上传参考图');
    downloaded += response.body.length;
    if (downloaded > 48 * 1024 * 1024) fail('素材超过 48 MB，请缩小作品范围后重试');
    return response.body;
  }
  async function json(path, form) {
    const bytes = await read(new URL(path, ORIGIN), form);
    try { return JSON.parse(bytes.toString('utf8')); } catch { fail('全景服务返回了无效数据'); }
  }
  try {
    const validation = await json('/panos/api/url/Validation', {urlString:token});
    if (validation.code !== 200 || validation.state !== 200 || Number(validation.data?.destroy) === 1 || Number(validation.data?.type) === 4) fail('分享链接已失效、仅限一次访问或不可公开读取，请重新分享或上传图片');
    const workStatus = validation.userVrInfo?.status;
    if (workStatus !== undefined && workStatus !== null && workStatus !== '' && Number(workStatus) !== 3) fail('作品已删除或尚未通过公开展示审核，不能导入');
    const params = new URLSearchParams(String(validation.data?.tUrl || '').replaceAll('%26', '&').split('#')[0]);
    const vid = params.get('vivi'), viewType = params.get('viewType') || '201';
    if (!/^\d{1,20}$/.test(vid || '') || !/^\d{1,6}$/.test(viewType)) fail('分享作品标识无效');
    if (viewType === '304') fail('置顶展示链接暂不支持导入，请使用普通分享链接或上传参考图');
    const access = await json('/panos/api/getUserDouSufficient', {vid, accessPortal:viewType});
    if (access.code !== 200) fail('该作品需要额外访问权限或支付，不能自动导入，请上传参考图');
    const response = await json('/panos/api/getVtShowInfo', {vid, viewCount:'1', viewType});
    if (response.code !== 200) fail('无法读取该作品的房间清单');
    const xml = (await read(new URL(`/pano/api/publik/pano/xml/scene/scenesof_${vid}.xml`, ORIGIN))).toString('utf8');
    const descriptors = sceneDescriptors(response.data, xml), scenes = [];
    for (const descriptor of descriptors) {
      if (combined.aborted) throw generationError(499, '素材导入已取消');
      const image = validateImage(await read(descriptor.thumbnail, undefined, 512 * 1024), 'image/jpeg');
      const faces = [];
      // Bounded sequential downloads avoid flooding the remote host or retaining many large responses.
      for (const url of descriptor.faces ?? []) faces.push(validateImage(await read(url), 'image/jpeg'));
      scenes.push({id:descriptor.id,name:descriptor.name,mime:'image/jpeg',image,...(faces.length === 6 ? {faces} : {})});
    }
    return { title:String(response.data.title || '导入全景').slice(0, 80), scenes };
  } catch (error) {
    if (combined.aborted) throw generationError(499, '素材导入超时或已取消，请重试或上传参考图');
    if (error.safeGenerationError) throw error;
    throw generationError(502, '暂时无法读取全景服务，请重试或上传房间参考图');
  }
}
