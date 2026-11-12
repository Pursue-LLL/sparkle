// [INPUT] @types/node 25 的 node:test 声明（MockModuleOptions 只有 defaultExport / namedExports）
// [OUTPUT] 补上 Node 26 的 mock.module `exports` 选项，测试里统一用它声明模块替身
// [POS] 仅供测试的类型补丁；@types/node 声明该选项后删除本文件
import 'node:test'

declare module 'node:test' {
  namespace test {
    interface MockModuleOptions {
      /** 替身的导出：对象的每个属性是一个具名导出，`default` 属性是默认导出 */
      exports?: object | undefined
    }
  }
}
