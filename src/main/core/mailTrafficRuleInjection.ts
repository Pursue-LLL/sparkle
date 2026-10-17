import { MAIL_DEDICATED_GROUP_NAME } from './cursorProxyGroup'

/**
 * 海外邮件客户端（IMAP / POP3 / SMTP）专用分流规则：
 * 精准匹配海外邮箱收发服务器域名并路由至 `📧 邮件专用`，
 * 避免落入封禁 993/465/587 邮件端口的普通机场节点导致 Mail.app 报 `-9806 SSL 错误`。
 * 国内邮箱（如 163.com / 126.com / qq.com）与浏览器网页版（mail.google.com 443）不在此列，保持原有路由。
 */
export const MAIL_TRAFFIC_RULE_BASES = [
  'DOMAIN,imap.gmail.com',
  'DOMAIN,smtp.gmail.com',
  'DOMAIN,pop.gmail.com',
  'DOMAIN-SUFFIX,googlemail.com',
  'DOMAIN,outlook.office365.com',
  'DOMAIN,smtp.office365.com',
  'DOMAIN,imap.mail.me.com',
  'DOMAIN,smtp.mail.me.com',
  'DOMAIN,imap.mail.yahoo.com',
  'DOMAIN,smtp.mail.yahoo.com'
] as const

function hasMailDedicatedGroup(profile: MihomoConfig): boolean {
  const groups = profile['proxy-groups'] as { name: string }[] | undefined
  return groups?.some((group) => group.name === MAIL_DEDICATED_GROUP_NAME) ?? false
}

/** Prepend overseas mail client endpoint rules so they route to `📧 邮件专用` before generic Google/Microsoft rules. */
export function injectMailTrafficRules(profile: MihomoConfig): void {
  if (!hasMailDedicatedGroup(profile)) {
    return
  }

  const existing = (profile.rules as string[] | undefined) ?? []
  const existingSet = new Set(existing.map((rule) => rule.trim()))
  const prefix: string[] = []

  for (const ruleBase of MAIL_TRAFFIC_RULE_BASES) {
    const rule = `${ruleBase},${MAIL_DEDICATED_GROUP_NAME}`
    if (!existingSet.has(rule)) {
      prefix.push(rule)
      existingSet.add(rule)
    }
  }

  if (prefix.length === 0) {
    return
  }

  profile.rules = [...prefix, ...existing] as MihomoConfig['rules']
}
