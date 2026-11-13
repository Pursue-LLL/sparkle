// [INPUT] 无本地依赖
// [OUTPUT] getAppConfig · getControledMihomoConfig · 订阅配置 / 订阅文件 / 覆写的读写接口
// [POS] config 模块的统一出口：把应用配置、内核控制配置、订阅配置、可编辑文件与覆写的读写接口集中重新导出。

export { getAppConfig, patchAppConfig } from './app'
export { getControledMihomoConfig, patchControledMihomoConfig } from './controledMihomo'
export {
  getProfile,
  getCurrentProfileItem,
  getProfileItem,
  getProfileConfig,
  setProfileConfig,
  addProfileItem,
  removeProfileItem,
  createProfile,
  getProfileStr,
  getProfileParseStr,
  setProfileStr,
  changeCurrentProfile,
  updateProfileItem
} from './profile'
export { getFileStr, getFilePreviewStr, setFileStr, saveFileStrWithElevation } from './profileFiles'
export {
  getOverrideConfig,
  setOverrideConfig,
  getOverrideItem,
  addOverrideItem,
  removeOverrideItem,
  createOverride,
  getOverride,
  setOverride,
  updateOverrideItem
} from './override'
