import { jsPDF } from 'jspdf';
export async function generateBacktestPDF(result: any, meta: any) {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text('QuantCEO 回测报告', 20, 20);
    doc.setFontSize(12);
    doc.text(`股票: ${meta.code}`, 20, 35);
    doc.text(`策略: ${meta.strategyName}`, 20, 43);
    doc.text(`回测区间: ${meta.startDate} ~ ${meta.endDate}`, 20, 51);
    doc.text(`报告生成: ${new Date().toLocaleDateString('zh-CN')}`, 20, 59);
    doc.setFontSize(14);
    doc.text('收益统计', 20, 75);
    doc.setFontSize(11);
    const stats = [
        ['总收益率', `${result.totalReturn.toFixed(2)}%`],
        ['年化收益率', `${result.annualReturn.toFixed(2)}%`],
        ['夏普比率', result.sharpe.toFixed(2)],
        ['最大回撤', `${result.maxDrawdown.toFixed(2)}%`],
        ['胜率', `${result.winRate.toFixed(1)}%`],
        ['交易次数', String(result.tradeCount)],
    ];
    stats.forEach(([label, value], i) => {
        doc.text(`${label}: ${value}`, 20, 85 + i * 8);
    });
    if (result.trades && result.trades.length > 0) {
        doc.setFontSize(14);
        doc.text('交易明细', 20, 145);
        doc.setFontSize(9);
        const headers = ['日期', '方向', '入场价', '出场价', '持股数', '收益', '收益率'];
        const colX = [20, 45, 70, 95, 120, 145, 170];
        headers.forEach((h, i) => doc.text(h, colX[i], 155));
        let y = 163;
        for (const t of result.trades.slice(0, 30)) {
            if (y > 280) {
                doc.addPage();
                y = 20;
            }
            const row = [
                t.entryDate,
                t.direction,
                t.entryPrice.toFixed(2),
                t.exitPrice.toFixed(2),
                String(t.shares),
                t.pnl.toFixed(2),
                `${t.returnPct.toFixed(2)}%`,
            ];
            row.forEach((cell, i) => doc.text(cell, colX[i], y));
            y += 6;
        }
    }
    const pdfBuffer = doc.output('arraybuffer');
    return Buffer.from(pdfBuffer);
}
