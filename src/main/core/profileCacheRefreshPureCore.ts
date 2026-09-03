export function formatMissingSubscriptionUrlError(locale: 'zh' | 'en' = 'zh'): string {
  return locale === 'zh'
    ? '订阅 URL 为空，无法从远端更新。请在订阅设置中填入链接。'
    : 'Subscription URL is empty. Add the subscription link in profile settings.'
}
