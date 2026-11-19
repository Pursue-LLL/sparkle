// [INPUT] 无
// [OUTPUT] glogStamp · generationRejectionRecord · fetchConfigRejectionRecord · fetchLicensesRejectionRecord · benignAicodeTimeoutRecord
// [POS] agy 生产证据测试的日志夹具：官方 CLI 日志里地区拒绝记录的真实形状（脱敏后）与一条健康出口上同样会出现的超时记录。
// glog 的时间戳用本地时间、没有年份，夹具按同样方式生成。仅供测试使用。

/** `MMDD HH:MM:SS.ffffff`：glog 行头里 level 字母之后的部分。 */
export function glogStamp(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.123456`
}

/** 生成请求被拒：一次用户可见的失败会连写两条这样的记录。 */
export const generationRejectionRecord = (ms: number): string =>
  `E${glogStamp(ms)}    1222 errorreport.go:307] agent executor error: generating and executing: FAILED_PRECONDITION (code 400): User location is not supported for the API use.`

/** aicode FetchConfig 被拒：整份 JSON 报文转义后落在一行里。 */
export const fetchConfigRejectionRecord = (ms: number): string =>
  `W${glogStamp(ms)}   16616 code_assist_client.go:475] AICode FetchConfig failed, falling back to CCPA ListExperiments: failed to make AI Code FetchConfig request: "403 Forbidden", body: "{\\n  \\"error\\": {\\n    \\"code\\": 403,\\n    \\"message\\": \\"Your location is not eligible for this service at this time. Detected location: CN.\\",\\n    \\"details\\": [\\n      {\\n        \\"reason\\": \\"LOCATION_NOT_ELIGIBLE\\",\\n        \\"domain\\": \\"aicode.googleapis.com\\"\\n      }\\n    ]\\n  }\\n}\\n"`

/** aicode FetchLicenses 被拒：JSON 报文换行，拒绝文案落在续行上。 */
export const fetchLicensesRejectionRecord = (ms: number): string =>
  [
    `I${glogStamp(ms)}   16642 aicode.go:377] Failed to make AI Code FetchLicenses request (https://aicode.googleapis.com/v1alpha:fetchLicenses): {`,
    '  "error": {',
    '    "code": 403,',
    '    "message": "Your location is not eligible for this service at this time. Detected location: CN.",',
    '    "details": [',
    '      {',
    '        "reason": "LOCATION_NOT_ELIGIBLE",',
    '        "domain": "aicode.googleapis.com"',
    '      }',
    '    ]',
    '  }',
    '}'
  ].join('\n')

/** aicode 只是超时：健康出口上同样会出现，不是地区拒绝。 */
export const benignAicodeTimeoutRecord = (ms: number): string =>
  `W${glogStamp(ms)}     320 code_assist_client.go:509] CCPA routed this account to AICode, but AICode FetchConfig failed, serving CCPA's flags: failed to make AI Code FetchConfig request: Get "https://aicode.googleapis.com/v1alpha:fetchConfig": context deadline exceeded`
