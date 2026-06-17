<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { api } from '../api'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const token = ref('')
const result = ref(null)
const error = ref('')
const querying = ref(false)

const hasCode = computed(() => result.value?.success && result.value?.code)
const lookupUrl = computed(() => {
  if (!token.value.trim()) return ''
  const url = new URL(window.location.href)
  url.pathname = '/code'
  url.search = ''
  url.searchParams.set('token', token.value.trim())
  return url.toString()
})

const queryCode = async () => {
  error.value = ''
  result.value = null
  if (!token.value.trim()) {
    error.value = '请输入查询 token'
    return
  }
  querying.value = true
  try {
    result.value = await api.fetchAddressMailCode(token.value.trim(), {
      limit: 10,
      minutes: 60,
    })
    if (!result.value?.success) {
      error.value = '最近 60 分钟内没有找到验证码'
    }
  } catch (e) {
    error.value = e.message || '查询失败'
  } finally {
    querying.value = false
  }
}

const copyText = async (text) => {
  await navigator.clipboard.writeText(text)
  message.success('已复制')
}

const saveTokenToUrl = () => {
  if (!token.value.trim()) return
  router.replace({
    path: '/code',
    query: { token: token.value.trim() },
  })
}

onMounted(() => {
  const tokenQuery = Array.isArray(route.query.token) ? route.query.token[0] : route.query.token
  if (typeof tokenQuery === 'string') {
    token.value = tokenQuery
    queryCode()
  }
})
</script>

<template>
  <main class="code-page">
    <section class="code-panel">
      <div class="title-row">
        <h1>验证码查询</h1>
        <n-button v-if="lookupUrl" size="small" secondary @click="copyText(lookupUrl)">
          复制专属链接
        </n-button>
      </div>

      <n-input
        v-model:value="token"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 5 }"
        placeholder="粘贴这个邮箱的 Address JWT / 查询 token"
        @blur="saveTokenToUrl"
      />

      <div class="actions">
        <n-button type="primary" :loading="querying" @click="queryCode">
          查询最新验证码
        </n-button>
      </div>

      <n-alert v-if="error" type="warning" :show-icon="false">
        {{ error }}
      </n-alert>

      <div v-if="hasCode" class="result">
        <div class="code">{{ result.code }}</div>
        <n-button secondary @click="copyText(result.code)">复制验证码</n-button>
        <div class="meta">
          <div>{{ result.address }}</div>
          <div v-if="result.mail?.subject">{{ result.mail.subject }}</div>
          <div v-if="result.mail?.created_at">{{ result.mail.created_at }}</div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.code-page {
  min-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.code-panel {
  width: min(680px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: left;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.result {
  border: 1px solid rgba(100, 116, 139, 0.28);
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.code {
  font-size: 44px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
}

.meta {
  color: #667085;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

@media (max-width: 640px) {
  .code-page {
    align-items: flex-start;
    padding: 16px;
  }

  .title-row {
    align-items: flex-start;
    flex-direction: column;
  }

  h1 {
    font-size: 24px;
  }

  .code {
    font-size: 36px;
  }
}
</style>
