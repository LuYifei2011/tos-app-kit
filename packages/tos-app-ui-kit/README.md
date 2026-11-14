# tos-app-ui-kit

配合 `tos-app-core/vue` 使用的 Vue 3 组件。先安装同一个 `createTosAppVue(core)` 上下文，再使用组件；设置、请求和诊断共享该实例。

## 两区应用框架

`TosAppShell` 从 `0.2.0` 开始提供标题栏和内容区，纯布局组件不读取应用上下文。

```vue
<script setup lang="ts">
import { TosAppShell } from 'tos-app-ui-kit'
</script>

<template>
  <TosAppShell :title="appName">
    <template #icon><AppIcon /></template>
    <template #header-extra><span>{{ shortStatus }}</span></template>
    <MyWorkspace />
  </TosAppShell>
</template>
```

| 接口 | 用途 |
| --- | --- |
| `title: string` | 页面唯一的应用 h1，长名称截断并保留完整 title 提示 |
| `contentClass?: string` | 为内容 main 添加应用自身的布局类 |
| `scroll="auto"` | 默认内容区滚动，标题栏保持固定 |
| `scroll="hidden"` | 内容区不滚动，由应用的列表或编辑区管理滚动 |
| `#icon` | 装饰性应用图标，外层已设置 aria-hidden |
| `#header-extra` | 标题旁的简短状态或附加内容 |
| 默认插槽 | 业务内容；内部使用 section/div，避免嵌套 main |

标题栏固定 41px，右侧默认预留 180px 给 TOS 窗口控件；可在应用根节点设置 `--tos-app-window-controls-width` 调整。外壳填满视口，内容区保留 `min-height: 0`。620px 以下切换为整页滚动，允许表单和分栏展开。分栏、底部状态、工具栏与业务对话框由应用组成。Shell 样式位于 `style.css`，同样需要导入 tokens，文档基础样式可选。

图标可由应用静态导入 `@lucide/vue`，通过插槽或业务按钮使用。Shell 本身不绑定图标库，应用品牌图标可独立提供。

## 设置和诊断

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
