<template>
  <div class="policy-page">
    <div class="policy-container">
      <h1>退款政策</h1>
      <p class="update-date">更新日期：2026 年 7 月 1 日</p>

      <section>
        <h2>一、概述</h2>
        <p>QuantCEO 由个人开发者 <strong>XIONG HAO</strong> 运营。我们致力于为用户提供满意的服务。如果您对 QuantCEO 的付费订阅不满意，我们提供明确的退款政策。本政策适用于通过本平台购买的所有付费订阅。</p>
      </section>

      <section>
        <h2>二、Pro 版退款条款</h2>
        <div class="policy-card">
          <h3>7 天无理由退款</h3>
          <p>购买 Pro 年度订阅后 <strong>7 天内</strong>，如您对服务不满意，可申请全额退款。无论任何原因，我们都会在收到申请后 5 个工作日内处理退款。</p>
        </div>
        <h3>退款条件</h3>
        <ul>
          <li>退款申请必须在购买后 7 天内提出</li>
          <li>超出 7 天后不予退款</li>
          <li>已在购买前通过试用期完全体验过功能的用户，一般不予退款（但我们会酌情处理）</li>
          <li>如有滥用退款政策的情况（如反复购买后退款），我们有权拒绝退款</li>
        </ul>
      </section>

      <section>
        <h2>三、Premium 版退款条款</h2>
        <p>Premium 年度订阅价格较高，服务内容明确，如您购买后需要退款，请在 <strong>48 小时内</strong>联系。</p>
      </section>

      <section>
        <h2>四、退款流程</h2>
        <ol>
          <li>通过 GitHub Issues 提交退款申请，注明您的注册邮箱</li>
          <li>我们会在 24 小时内确认您的购买记录</li>
          <li>确认符合退款条件后，我们在 5 个工作日内处理退款</li>
          <li>退款将原路返回至您的支付账户（微信 / 支付宝）</li>
        </ol>
      </section>

      <section>
        <h2>五、不可退款的情况</h2>
        <ul>
          <li>超过退款期限的订阅</li>
          <li>免费版用户（未产生实际费用）</li>
          <li>自主部署的企业版（包括 Pro 自部署、企业版、源码授权）—— 请在企业版合同中另行约定</li>
          <li>因违反服务条款而被取消的账号</li>
        </ul>
      </section>

      <section>
        <h2>六、续费和自动续费</h2>
        <ul>
          <li>Pro 和 Premium 订阅为年度订阅，到期后如需继续使用需要续费</li>
          <li>当前版本不提供自动续费功能，到期后会自动降级为免费版</li>
          <li>如将来开通自动续费，我们会在扣费前通过邮件通知您</li>
        </ul>
      </section>

      <section>
        <h2>七、运营方信息</h2>
        <p>QuantCEO 由个人开发者运营。退款申请或任何疑问，请通过以下方式联系我们：</p>
        <ul>
          <li>联系邮箱：<a href="mailto:435541900@qq.com">435541900@qq.com</a></li>
          <li>GitHub Issues：<a href="https://github.com/xionghao1012/quantceo/issues" target="_blank">github.com/xionghao1012/quantceo/issues</a></li>
        </ul>
        <p>请在申请中提供：注册邮箱、购买时间、退款原因（可选）</p>
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
ul, ol {
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
.policy-card {
  background: rgba(79, 195, 247, 0.08);
  border: 1px solid rgba(79, 195, 247, 0.2);
  border-radius: var(--radius-md);
  padding: 20px;
  margin: 16px 0;
}
.policy-card h3 {
  color: var(--accent, #4fc3f7);
  margin-top: 0;
}
</style>
