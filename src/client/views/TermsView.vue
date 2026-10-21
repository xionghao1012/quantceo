<template>
  <div class="policy-page">
    <div class="policy-container">
      <h1>服务条款</h1>
      <p class="update-date">更新日期：2026 年 7 月 1 日</p>

      <section>
        <h2>一、接受条款</h2>
        <p>使用 QuantCEO（以下简称"本平台"）即表示您同意本服务条款。如您不同意任何条款，请停止使用本平台。本平台保留随时修改条款的权利，修改后的条款自发布之日起生效。</p>
      </section>

      <section>
        <h2>二、服务描述</h2>
        <p>QuantCEO 是一个提供 A 股量化分析工具的 SaaS 平台，由个人开发者 XIONG HAO 开发和运营，主要面向个人投资者提供以下服务：</p>
        <ul>
          <li>实时 A 股行情展示和技术指标分析（RSI、MACD、移动均线等）</li>
          <li>策略回测引擎（单股和组合回测）</li>
          <li>信号扫描和股票筛选（每日精选、信号扫描器）</li>
          <li>AI 预测和情绪分析（基于大语言模型）</li>
          <li>持仓管理和交易日志</li>
          <li>通知推送服务（市场告警）</li>
        </ul>
        <p>本平台以开源软件（MIT 协议）的形式提供基础功能，高级功能需付费订阅 Pro 或 Premium 套餐。具体套餐和价格请参阅 <router-link to="/upgrade">定价页面</router-link>。</p>
      </section>

      <section>
        <h2>三、免责声明</h2>
        <div class="warning-box">
          <p><strong>重要提示：本平台不构成投资建议。</strong></p>
          <p>QuantCEO 提供的所有数据、指标、信号、AI 预测、情绪分析等内容仅供参考和研究用途，<strong>不构成任何投资建议、买卖建议或投资决策依据</strong>。股票、基金等金融产品投资具有风险，您应基于独立判断做出投资决策，并自行承担投资风险。</p>
          <p>本平台不对以下事项承担责任：</p>
          <ul>
            <li>因使用本平台信息而导致的任何投资损失</li>
            <li>数据延迟、遗漏或不准确</li>
            <li>AI 预测结果的准确性</li>
            <li>技术故障或服务中断</li>
          </ul>
        </div>
      </section>

      <section>
        <h2>四、用户责任</h2>
        <ul>
          <li>您必须年满 18 岁或具有完全民事行为能力</li>
          <li>您对使用本平台进行的所有活动负责</li>
          <li>您不得利用本平台进行违法违规活动</li>
          <li>您不得试图破解、逆向工程或干扰本平台的正常运行</li>
          <li>您不得滥用 API 接口进行大规模抓取或攻击</li>
          <li>您应妥善保管账号密码，因账号泄露导致的损失由您自行承担</li>
        </ul>
      </section>

      <section>
        <h2>五、知识产权</h2>
        <p>QuantCEO 开源版本（OSS）基于 <a href="https://opensource.org/licenses/MIT" target="_blank">MIT 协议</a>发布。您有权使用、修改、复制和分发开源代码，但需保留原始版权声明。</p>
        <p>Pro 版本和注册商标 QuantCEO 的知识产权归开发团队所有。未经授权，不得将 Pro 功能代码用于其他商业项目。</p>
      </section>

      <section>
        <h2>六、订阅和付费</h2>
        <h3>6.1 订阅计划</h3>
        <ul>
          <li><strong>免费版（Free）</strong>：基础功能免费使用，受每日使用次数限制</li>
          <li><strong>Pro 版</strong>：付费订阅，按年计费，享受全部高级功能</li>
          <li><strong>Premium 版</strong>：付费订阅，包含 API 接入和专属客服</li>
        </ul>
        <h3>6.2 价格变更</h3>
        <p>我们保留调整价格的权利。价格变更将在新订阅周期生效，不追溯已订阅用户。</p>
        <h3>6.3 退款政策</h3>
        <p>Pro 版提供 7 天无理由退款。详情请参阅 <router-link to="/refund-policy">退款政策</router-link>。</p>
      </section>

      <section>
        <h2>七、开源版本</h2>
        <p>QuantCEO OSS 版本以 MIT 协议开源，您可以在 <a href="https://github.com/xionghao1012/quantceo" target="_blank">GitHub</a> 获取源代码。您可以自由地：</p>
        <ul>
          <li>将本软件用于个人或商业目的</li>
          <li>修改源代码</li>
          <li>重新分发原始或修改后的版本</li>
        </ul>
        <p>但须注意：开源版本不包含 AI 预测、持仓管理等 Pro 功能。如需完整功能，请购买 Pro 订阅。</p>
      </section>

      <section>
        <h2>八、服务可用性</h2>
        <ul>
          <li>我们尽力确保服务稳定运行，但不保证 100% 可用</li>
          <li>我们会进行定期维护，维护期间可能短暂不可用</li>
          <li>数据来源（搜狐财经、腾讯财经等）可能偶尔中断，导致行情延迟</li>
          <li>因不可抗力（自然灾害、战争、政府行为等）导致的服务中断，我们不承担责任</li>
        </ul>
      </section>

      <section>
        <h2>九、终止</h2>
        <p>我们保留在以下情况下终止或暂停您账号的权利：</p>
        <ul>
          <li>违反本服务条款</li>
          <li>从事违法违规活动</li>
          <li>滥用平台资源</li>
          <li>长期未使用（超过 12 个月）</li>
        </ul>
      </section>

      <section>
        <h2>十、适用法律</h2>
        <p>本服务条款受中华人民共和国法律管辖。如发生争议，双方应友好协商解决；协商不成的，提交有管辖权的人民法院裁决。</p>
      </section>

      <section>
        <h2>十一、运营方信息</h2>
        <p>QuantCEO 由个人开发者 <strong>XIONG HAO</strong> 运营。</p>
        <ul>
          <li>运营方：XIONG HAO（个人开发者）</li>
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
.warning-box {
  background: rgba(255, 152, 0, 0.1);
  border-left: 4px solid #ff9800;
  padding: 16px;
  border-radius: var(--radius-md);
  margin: 16px 0;
}
.warning-box p {
  margin-bottom: 8px;
}
</style>
