/**
 * 把 Koishi 的 ctx.http 适配成各 service 需要的 fetch 形状。
 * ctx.http 返回的是 { data, status }，service 只关心 body，这里统一拆开。
 */
export function createKoishiHttpFetch(http: any, timeoutMs: number) {
  if (!http) return undefined
  return async (url: string, init: Record<string, any> = {}) => {
    const options: Record<string, any> = {
      method: init.method,
      headers: init.headers,
      responseType: init.responseType,
      // 单次请求可按需放宽（详情接口比搜索大得多）
      timeout: init.timeout ?? timeoutMs,
      signal: init.signal,
      validateStatus: () => true,
    }
    if (init.body !== undefined) options.data = JSON.parse(init.body)
    const response = await http(url, options)
    if (response && typeof response === 'object' && 'data' in response && 'status' in response) return response.data
    return response
  }
}
