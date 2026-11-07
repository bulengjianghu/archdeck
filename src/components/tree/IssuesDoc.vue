<script setup lang="ts">
/** LY-4a：「问题」资料标签的正文——返工清单（原导航树「问题」页签，W-6，归侧栏模块）；不跟随主语，画布左上的 ⚠ 胶囊或「+」打开它 */
import IssueList from './IssueList.vue'
</script>

<template>
  <div class="issues-doc">
    <IssueList />
  </div>
</template>

<style scoped>
.issues-doc {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 0 12px;
  font-size: 12.5px;
  scrollbar-width: thin;
}
</style>
