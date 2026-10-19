import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import '@vue-flow/core/dist/style.css'
import './styles.css'
import App from './App.vue'
import { createDeskState, type ModelPayload } from './state/useDeskState'
import { DESK_STATE } from './state/inject'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', component: { render: () => null } }],
})

async function fetchModel(): Promise<ModelPayload> {
  const res = await fetch(`${import.meta.env.BASE_URL}model.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`读取 model.json 失败：HTTP ${res.status}`)
  return res.json()
}

const desk = createDeskState(fetchModel)
desk.attachRouter(router)
// 开发态便于在浏览器控制台检查状态
if (import.meta.env.DEV) (window as unknown as { __desk: typeof desk }).__desk = desk

// 开发态：模型文件变化后重新加载，保留当前层次与选中
import.meta.hot?.on('arch-model:changed', () => void desk.reload())

const app = createApp(App)
app.provide(DESK_STATE, desk)
app.use(router)
router.isReady().then(() => desk.init())
app.mount('#app')
