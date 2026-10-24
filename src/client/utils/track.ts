/**
 * 最小埋点：只记「用户做了什么」，不记内容、不引第三方 SDK。
 *
 * 为什么需要：产品此前零埋点，改完「正门」也无法回答「新用户有没有跑通」。
 * 失败必须静默（keepalive + catch），埋点永远不能影响用户操作。
 */

interface TrackProps {
  [key: string]: string | number | boolean | null | undefined
}

export function track(event: string, props: TrackProps = {}): void {
  try {
    const body = JSON.stringify({
      event,
      props,
      path: location.pathname,
    })
    // keepalive：用户点完立刻跳转时也能把事件送出去
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 埋点失败不影响任何用户操作
  }
}
