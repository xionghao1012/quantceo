<template>
  <div class="policy-page">
    <div class="policy-container">
      <h1>隐私政策</h1>
      <p class="update-date">更新日期：2026 年 7 月 1 日</p>

      <section>
        <h2>一、引言</h2>
        <p>QuantCEO（以下简称"本平台"或"我们"）由个人开发者 <strong>XIONG HAO</strong> 运营。我们尊重并保护您的隐私。本隐私政策说明我们在您使用本平台时如何收集、使用、存储和保护您的个人信息。</p>
        <p>使用本平台即表示您同意本隐私政策的条款。如您不同意，请停止使用本平台。</p>
      </section>

      <section>
        <h2>二、我们收集的信息</h2>
        <h3>2.1 您主动提供的信息</h3>
        <ul>
          <li><strong>注册信息</strong>：邮箱地址、用户名、密码（经过 bcrypt 哈希加密存储）</li>
          <li><strong>个人资料</strong>：头像、昵称等（可选）</li>
          <li><strong>使用数据</strong>：自选股列表、策略设置、回测参数、持仓记录等</li>
          <li><strong>支付信息</strong>：我们通过微信支付、支付宝等第三方支付平台处理支付，我们不存储您的银行卡号或支付密码</li>
        </ul>
        <h3>2.2 自动收集的信息</h3>
        <ul>
          <li><strong>登录日志</strong>：IP 地址、登录时间、浏览器 User-Agent</li>
          <li><strong>使用记录</strong>：功能使用频次（用于秒数限频限制）</li>
          <li><strong>JWT Token</strong>：用于维持登录状态，存储在浏览器 localStorage</li>
        </ul>
      </section>

      <section>
        <h2>三、我们如何使用信息</h2>
        <ul>
          <li>提供、维护和改进本平台功能</li>
          <li>验证用户身份和授权</li>
          <li>处理订阅和支付事务</li>
          <li>发送服务通知（如信号推送、持仓告警）</li>
          <li>分析使用趋势以优化产品体验</li>
          <li>遵守法律法规要求</li>
        </ul>
      </section>

      <section>
        <h2>四、信息的存储和保护</h2>
        <ul>
          <li>数据存储在中国境内阿里云服务器（PostgreSQL 数据库）</li>
          <li>密码使用 bcrypt 哈希加密，不可逆</li>
          <li>JWT 密钥存储在服务器端，不对外泄露</li>
          <li>所有 API 通信使用 HTTPS 加密</li>
          <li>我们定期备份数据以防止丢失</li>
        </ul>
        <p>但我们无法保证绝对安全。您应妥善保管自己的账号密码，如发现异常请立即联系我们。</p>
      </section>

      <section>
        <h2>五、信息的共享</h2>
        <p>我们不会将您的个人信息出售给第三方。仅在以下情况下可能共享：</p>
        <ul>
          <li><strong>支付处理</strong>：与微信支付、支付宝等支付平台共享必要信息以完成交易</li>
          <li><strong>AI 服务</strong>：与 MiniMax API 共享脱敏后的数据以提供 AI 预测和情绪分析（不含您的身份信息）</li>
          <li><strong>法律要求</strong>：应法律法规或政府机构要求提供</li>
          <li><strong>企业部署</strong>：您选择本地化部署版本时，所有数据完全存储在您自有服务器，我们不接触任何数据</li>
        </ul>
      </section>

      <section>
        <h2>六、您的权利</h2>
        <ul>
          <li><strong>访问</strong>：登录后可在个人中心查看您的账户信息</li>
          <li><strong>更正</strong>：可在个人中心修改邮箱、密码等资料</li>
          <li><strong>删除</strong>：联系我们可以删除您的账号及关联数据</li>
          <li><strong>导出</strong>：您可以要求导出您的数据</li>
          <li><strong>撤回同意</strong>：取消订阅或删除账号即视为撤回同意</li>
        </ul>
      </section>

      <section>
        <h2>七、Cookie 和本地存储</h2>
        <p>我们使用浏览器 localStorage 存储 JWT Token 和用户偏好设置。我们未使用第三方跟踪 Cookie。您可以在浏览器设置中清除这些数据。</p>
      </section>

      <section>
        <h2>八、儿童隐私</h2>
        <p>本平台不面向 18 岁以下未成年人。我们不会故意收集未成年人的个人信息。</p>
      </section>

      <section>
        <h2>九、隐私政策更新</h2>
        <p>我们可能不时更新本隐私政策。重大变更时我们会在平台上发布通知。继续使用即视为接受更新后的政策。</p>
      </section>

      <section>
        <h2>十、运营方信息</h2>
        <p>QuantCEO 由个人开发者运营。如对本隐私政策有任何疑问，请通过以下方式联系我们：</p>
        <ul>
          <li>联系邮箱：<a href="mailto:435541900@qq.com">435541900@qq.com</a></li>
          <li>GitHub Issues：<a href="https://github.com/xionghao1012/quantceo/issues" target="_blank">github.com/xionghao1012/quantceo/issues</a></li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.policy-page {
  padding: 40px 20px;
  max-width: 800px;
  margin: 0 auto;
  color: var(--text-primary, #e0e0e0);
}
.policy-container {
  background: var(--bg-card, #1e1e1e);
  border-radius: var(--radius);
  padding: 40px;
  border: 1px solid var(--border-color, #333);
}
h1 {
  font-size: 1.8rem;
  margin-bottom: 8px;
  color: var(--text-primary, #fff);
}
.update-date {
  color: var(--text-secondary, #999);
  font-size: 0.9rem;
  margin-bottom: 32px;
}
h2 {
  font-size: 1.25rem;
  margin: 24px 0 12px;
  color: var(--accent, #4fc3f7);
}
h3 {
  font-size: 1.05rem;
  margin: 16px 0 8px;
  color: var(--text-primary, #ddd);
}
p {
  line-height: 1.7;
  margin-bottom: 12px;
  color: var(--text-secondary, #bbb);
}
ul {
  padding-left: 20px;
  margin-bottom: 16px;
}
li {
  line-height: 1.7;
  margin-bottom: 6px;
  color: var(--text-secondary, #bbb);
}
a {
  color: var(--accent, #4fc3f7);
}
section {
  margin-bottom: 8px;
}
</style>
