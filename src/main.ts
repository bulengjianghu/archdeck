import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import '@vue-flow/core/dist/style.css'
import './styles.css'
import App from './App.vue'
import ProjectList from './components/ProjectList.vue'
import DeskView from './components/DeskView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: ProjectList, meta: { title: '架构台' } },
    { path: '/p/:project', name: 'project', component: DeskView, props: true },
    // 设计版本（ADR-0002）
    { path: '/p/:project/d/:design/:revision', name: 'design', component: DeskView, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

createApp(App).use(router).mount('#app')
