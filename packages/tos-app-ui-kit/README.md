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

文件对话框和路径输入框的通用图标使用 `@lucide/vue`，静态导入所需图标，默认尺寸 18px、线宽 1.6px，颜色跟随控件文字。应用也可静态导入 `@lucide/vue`，通过插槽或业务按钮使用。Shell 本身不绑定图标库，应用品牌图标可独立提供。

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

## NAS 文件对话框

使用 TOS 目录接口时，列表反映当前登录用户的权限，可能与应用后端服务账号不同。需要后端处理所选文件时，通常建议使用按后端实际访问权限提供目录的自定义 provider，参见 [文件服务说明](../../go/files/README.md)。

`TosFileDialog` 提供打开文件、选择文件夹、保存文件和保存文件夹四种模式，使用上下文的 `core.files` 或组件的 `provider` 属性读取 NAS 目录。注册可选 Go 文件服务后，在 `createTosApp` 中设置 `files: true` 即可使用；也可按 [core 文件服务契约](../tos-app-core/README.md#nas-文件服务)接入自定义 provider。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TosFileDialog } from 'tos-app-ui-kit'
import type { TosFileDialogResult } from 'tos-app-core'

const open = ref(false)
const filters = [{ label: '文本文件', extensions: ['.txt', '.md'] }]
function selected(result: TosFileDialogResult) {
  // 将 result.paths 交给应用自己的读取、导出或保存流程。
  console.log(result.paths, result.overwrite)
}
</script>

<template>
  <button @click="open = true">打开 NAS 文件</button>
  <TosFileDialog v-model="open" mode="open" kind="file" multiple
    :filters="filters" @select="selected" />
</template>
```

| 接口 | 用途 |
| --- | --- |
| `v-model: boolean` | 打开或关闭；每次打开创建独立会话并重新加载初始目录 |
| `mode?: 'open' \| 'save'` | 默认 `open`；保存模式填写目标名称 |
| `kind?: 'file' \| 'directory'` | 默认 `file`；`directory` 只显示文件夹 |
| `multiple?: boolean` | 打开模式允许多选，默认单选；保存模式始终一个目标 |
| `initialPath?: string \| null` | 初始 NAS 目录；默认 `null` 为共享文件夹列表 |
| `defaultName?: string` | 保存模式的初始文件或文件夹名称 |
| `filters?: TosFileFilter[]` | 文件扩展名筛选，首项为默认；扩展名带点、忽略大小写，空数组表示全部文件 |
| `title?: string` | 覆盖默认中英标题 |
| `provider?: TosFileProvider` | 覆盖 `core.files`，用于不同文件来源或隔离测试 |
| `@select(result)` | 确认成功后返回 `{ mode, kind, paths, overwrite }` 并关闭对话框 |
| `@cancel` | 点击取消、关闭或按 Escape；父组件直接关闭不触发此事件 |

除标题外，配置在每次打开时读取；修改选择条件或 provider 时先关闭再打开。`filters[].label` 和自定义标题由调用方翻译。文件类型筛选不自动补扩展名，保存名称不符合当前类型时会显示校验提示。

桌面布局包含共享文件夹侧栏、后退/前进/上一级、面包屑、可编辑路径和当前目录名称筛选。侧栏由 `provider.list(null)` 返回的可访问共享文件夹组成；点击路径编辑按钮或按 Ctrl/Meta+L 输入 NAS 绝对路径，空路径返回共享根。详情列表按文件夹优先排列，显示名称、修改日期、类型和大小；可选 `size`/`modifiedAt` 缺省时显示 `—`。

单击一行选择项目，多选时 Ctrl/Meta+单击切换选择、Shift+单击选择连续范围。方向键及 Home/End 移动选择，Ctrl/Meta+方向键只移动焦点，Space 切换当前项，Ctrl/Meta+A 选择当前显示且符合目标类型的项目。Enter 或双击进入目录；对文件执行 Enter 或双击确认选择。文件模式选中单个目录时，底部主按钮用于打开目录。文件夹模式未选择项目时可选择当前目录，共享文件夹虚拟根不能作为目标。导航、名称筛选和文件类型切换清空选择，保留已输入的保存名称。

保存文件夹时在父目录填写目标文件夹名称；已有同名文件夹会要求确认使用该目标。保存文件遇到同名文件会要求覆盖确认；不同类型的同名项目会阻止确认。同名确认使用独立模态层，显示目标路径，初始焦点在取消；取消或 Escape 关闭该层并保留主对话框中的名称和选择，焦点返回主操作按钮。对话框只选择路径，不创建目录、不读取文件内容或写入文件。应用在收到结果后执行自己的文件操作；`overwrite: true` 表示用户已确认使用现有目标，文件夹合并或替换语义由应用决定。

组件包含目录加载、空列表、失败重试、失效路径复核和请求取消；支持模态焦点约束、Escape 关闭和关闭后焦点恢复。使用原生 HTML `dialog.showModal()`，需要支持该 API 的浏览器；在 TOS iframe 内只覆盖当前应用区域。桌面宽度上限 840px、内容高度上限 540px，并受视口约束，适用于 960×600 应用区域。样式沿用系统字体、蓝色选择态和现有浅深主题；720px 以下隐藏修改日期，620px 以下隐藏侧栏和其他元数据、保留可见路径编辑入口，控件与文件行使用 44px 高度，目录行显示触摸进入按钮。

运行根目录 `npm run dev` 可体验四种模式。示例使用内存目录，包含中文和长文件名、空目录、拒绝访问目录及同名目标。

## 路径输入框

`TosPathInput` 将单个 NAS 路径的文本框与右侧文件夹图标按钮组合在一起，点击按钮打开 `TosFileDialog`，确认后更新字符串 `v-model`。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TosPathInput } from 'tos-app-ui-kit'

const path = ref('/共享文档')
</script>

<template>
  <label for="output-path">输出文件夹</label>
  <TosPathInput id="output-path" v-model="path" kind="directory" :editable="false" />
</template>
```

- `editable` 默认 `true`：直接输入时更新 `v-model`；设为 `false` 时文本框只读，仍可选中复制路径或通过图标按钮选择。
- `disabled` 默认 `false`：设为 `true` 时同时禁用文本框和按钮，并关闭已打开的对话框。
- `mode`、`kind`、`filters`、`provider` 与文件对话框一致，默认打开文件；组件始终选择单个路径。`dialogTitle` 可自定义对话框标题。
- 未显式指定 `initialPath` 时，打开文件夹从当前路径开始，打开/保存文件及保存文件夹从当前路径的父目录开始；空值或相对路径回到共享根。保存时从当前路径提取默认名称，可通过 `defaultName` 覆盖。显式 `initialPath`（包括 `null`）优先。
- `@select` 返回完整 `TosFileDialogResult`，包含覆盖确认信息；`@cancel` 表示取消对话框，输入值保持原样。
- `id`、`name`、`placeholder`、`required`、`aria-label`、`aria-describedby` 等额外属性透传到文本框。通过外部 `label` 或 `aria-label` 提供具体字段名。

直接输入的路径按原样返回，不自动检查是否存在或是否有权限；应用在提交时校验。实际文件操作由应用执行，保存对话框选择目标的契约保持一致。
