# tos-app-ui-kit

配合 `tos-app-core/vue` 使用的 Vue 3 组件。先安装同一个 `createTosAppVue(core)` 上下文，再使用组件；设置、请求和诊断共享该实例。

```ts
import 'tos-app-ui-kit/tokens.css'
// 可选：独立 iframe 应用的文档基础样式。
import 'tos-app-ui-kit/base.css'
// 组件样式。
import 'tos-app-ui-kit/style.css'
```

```vue
<script setup lang="ts">
import { TosPreferencesForm, TosConnectionReport } from 'tos-app-ui-kit'
</script>

<template>
  <TosPreferencesForm />
  <TosConnectionReport />
</template>
```

`TosPreferencesForm` 直接绑定上下文中的语言和主题偏好，保留持久化与回退行为。`TosConnectionReport` 默认读取上下文诊断，空诊断时不渲染；也可传入 `report` 属性。完整报告可展开、聚焦和选中，多实例的 textarea 使用不同 ID。两个组件均自带 scoped 样式和中英切换。

`tokens.css` 显式设置文档根元素的浅深语义颜色变量，应用可在其后覆盖。`base.css` 是可选的全局排版、原生表单、按钮类、键盘焦点和窄屏样式。`style.css` 提供组件的 scoped 样式。组件以 ESM 和类型声明分发，三份样式均显式导入；也可由应用提供等价主题变量。

以后文件选择器可以在这个包提供完整交互，通过上下文访问 core 的文件服务；应用只需传选择条件并接收选择结果。
