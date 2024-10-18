'use strict'

/**
 * 配置部分
 */
// 静态资源的基础URL，用于访问404页面等静态文件
const ASSET_URL = 'https://t.me/CMLiussss'
// URL前缀，如果你的网站是 example.com/gh/* 这样的格式，就需要设置成 '/gh/'
const PREFIX = '/'
// 是否使用 jsDelivr 镜像来加速分支文件访问，0表示关闭
const Config = {
    jsdelivr: 0
}

// 白名单列表，如果设置了白名单，只有包含白名单字符串的路径才会被处理
// 例如：['/username/'] 只允许访问特定用户的仓库
const whiteList = []

// 预检请求（OPTIONS）的响应配置
const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',           // 允许所有源
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS', // 允许的HTTP方法
        'access-control-max-age': '1728000',          // 预检请求的有效期
    }),
}

// 正则表达式匹配不同类型的GitHub URL
const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i  // releases和压缩包
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i          // 文件内容
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i           // Git信息
const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i // Raw文件
const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i     // Gist
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i                    // 标签页面

/**
 * 创建统一格式的响应
 * @param {any} body - 响应体
 * @param {number} status - HTTP状态码
 * @param {Object} headers - 响应头
 */
function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, {status, headers})
}

/**
 * 创建URL对象，如果失败返回null
 * @param {string} urlStr - URL字符串
 */
function newUrl(urlStr) {
    try {
        return new URL(urlStr)
    } catch (err) {
        return null
    }
}

/**
 * 检查URL是否匹配任一GitHub相关正则表达式
 * @param {string} u - 要检查的URL
 */
function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (u.search(i) === 0) {
            return true
        }
    }
    return false
}

/**
 * 处理HTTP请求的核心函数
 * @param {Request} req - 原始请求对象
 * @param {string} pathname - 请求路径
 */
async function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers

    // 处理预检请求（跨域请求前的OPTIONS请求）
    if (req.method === 'OPTIONS' &&
        reqHdrRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT)
    }

    // 创建新的请求头
    const reqHdrNew = new Headers(reqHdrRaw)

    // 检查白名单
    let urlStr = pathname
    let flag = !Boolean(whiteList.length)  // 如果白名单为空，则默认允许所有请求
    for (let i of whiteList) {
        if (urlStr.includes(i)) {
            flag = true
            break
        }
    }
    if (!flag) {
        return new Response("blocked", {status: 403})
    }

    // 确保URL以https://开头
    if (urlStr.search(/^https?:\/\//) !== 0) {
        urlStr = 'https://' + urlStr
    }
    const urlObj = newUrl(urlStr)

    // 准备转发请求的配置
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',    // 手动处理重定向
        body: req.body
    }
    return proxy(urlObj, reqInit)
}

/**
 * 代理请求处理函数
 * @param {URL} urlObj - 目标URL对象
 * @param {RequestInit} reqInit - 请求配置
 */
async function proxy(urlObj, reqInit) {
    const res = await fetch(urlObj.href, reqInit)
    const resHdrOld = res.headers
    const resHdrNew = new Headers(resHdrOld)

    const status = res.status

    // 处理重定向
    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location')
        if (checkUrl(_location))
            resHdrNew.set('location', PREFIX + _location)
        else {
            reqInit.redirect = 'follow'
            return proxy(newUrl(_location), reqInit)
        }
    }

    // 设置CORS相关响应头
    resHdrNew.set('access-control-expose-headers', '*')
    resHdrNew.set('access-control-allow-origin', '*')

    // 删除可能导致问题的安全响应头
    resHdrNew.delete('content-security-policy')
    resHdrNew.delete('content-security-policy-report-only')
    resHdrNew.delete('clear-site-data')

    return new Response(res.body, {
        status,
        headers: resHdrNew,
    })
}

/**
 * 主要的请求处理函数
 * @param {Request} request - 原始请求对象
 */
async function handleRequest(request) {
    const urlStr = request.url
    const urlObj = new URL(urlStr)
    // 检查是否有查询参数q
    let path = urlObj.searchParams.get('q')
    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301)
    }
    
    // 处理路径，移除前缀并规范化URL格式
    path = urlObj.href.substr(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://')
    
    // 根据不同的URL模式选择不同的处理方式
    if (path.search(exp1) === 0 || path.search(exp5) === 0 || path.search(exp6) === 0 || path.search(exp3) === 0 || path.search(exp4) === 0) {
        return httpHandler(request, path)
    } else if (path.search(exp2) === 0) {
        // 处理blob/raw文件
        if (Config.jsdelivr) {
            // 如果启用了jsDelivr，转换URL到jsDelivr CDN
            const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh')
            return Response.redirect(newUrl, 302)
        } else {
            // 否则转换到raw.githubusercontent.com
            path = path.replace('/blob/', '/raw/')
            return httpHandler(request, path)
        }
    } else if (path.search(exp4) === 0) {
        // 处理raw文件的jsDelivr转换
        const newUrl = path.replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, '@$1').replace(/^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/, 'https://cdn.jsdelivr.net/gh')
        return Response.redirect(newUrl, 302)
    } else {
        // 如果都不匹配，返回静态资源
        return fetch(ASSET_URL + path)
    }
}

/**
 * Cloudflare Pages 的入口函数
 */
export default {
    async fetch(request, env, ctx) {
        try {
            return await handleRequest(request)
        } catch (err) {
            return makeRes('Server Error:\n' + err.stack, 502)
        }
    }
}
