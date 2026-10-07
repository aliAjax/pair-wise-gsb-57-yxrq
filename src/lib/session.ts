/**
 * 每个浏览器标签页（窗口）持有一个稳定的提交标识，
 * 用于模拟两个窗口同时提交同一回执批次时的先到/后到判定。
 */
export function getClientToken(): string {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return 'server-token'
  }
  const existing = window.sessionStorage.getItem('privacy-rights-window-token')
  if (existing) return existing
  const token =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `token-${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.sessionStorage.setItem('privacy-rights-window-token', token)
  return token
}
