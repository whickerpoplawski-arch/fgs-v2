/**
 * 上下文同步 hook（CONTRACT §9）。
 *
 * 图变 → 下一轮 Decide/Execute 看到最新 YAML/投影。
 * 每次 Decide/Execute 会话干净上下文：system 规则 + 本轮 user（整图 YAML + 角色附录）。
 */

/** Decide 轮 user 消息：整图 YAML + 工作目录附录。 */
export function decideUserMessage(store, graph, workspaceSummary = '') {
  const parts = [store.toYaml(graph)];
  if (workspaceSummary) parts.push(`【工作目录里的文件】\n${workspaceSummary}`);
  parts.push('请判断下一步,操作记入草稿后 commit。');
  return parts.join('\n\n');
}

/** Execute 轮 user 消息：整图 YAML + 负责的 step。 */
export function executeUserMessage(store, graph, stepId, stepAction) {
  return `${store.toYaml(graph)}\n\n【你负责的 step】${stepId}\n${stepAction}`;
}

/** 当前角色 + 当前 step + 图投影，作为每步的运行时上下文注入。 */
export function roleContextText({
  role, store, graph, currentStep = null, draftSummary = '', ioSpec = null,
  graphMutationTools = null, executeDeniedGraphTools = null, injectMaxChars = 24000,
}) {
  if (!graph || !store) return '';
  const lines = [`【FGS 当前角色】${roleLabel(role)}`];
  const openSteps = (graph.steps ?? []).filter((s) => s.state === 'open');
  if (role === 'execute') {
    if (currentStep) lines.push(`【本轮必须收束的 step】${currentStep.id}: ${currentStep.action}`);
    lines.push('【本轮可用图工具】fgs_submit_fact → fgs_commit_step（fgs_status 只读）。');
    lines.push('结束时必须调用 fgs_commit_step 落一条新 Fact（无产出也要落显式失败/观察 Fact）。');
    // v2：图操作工具在两类活动都放行（见 index.js 的 GRAPH_MUTATION_TOOLS）。
    // ⚠️ 这里必须**按守卫的真实列表渲染**，不能写死一份「会被拒」的清单：
    // 实测教训 —— 写死清单后提示词与 guard 打架（guard 放行、提示词说会被拒），
    // 模型于是**自我审查**，明明可用的图工具也不敢用，观测点「图不僵死」在执行侧落空。
    if (Array.isArray(graphMutationTools) && graphMutationTools.length > 0) {
      lines.push(`图操作工具（${graphMutationTools.join(' / ')}）本轮**照常放行**`
        + '（v2：两类活动都放行，它们只动 FGS 图、不动世界状态，图不会因为持有 step 而僵死）。');
      const denied = Array.isArray(executeDeniedGraphTools) ? executeDeniedGraphTools : [];
      if (denied.length > 0) {
        lines.push(`本轮会被拒的图工具：${denied.join(' / ')}（goal 级判断由 Decide 独占）。`);
      }
    } else {
      // 兜底：调用方没给守卫列表时，只声明**确定会被拒**的 goal 级工具，不再多列。
      lines.push('goal 级工具（fgs_satisfy_goal / fgs_reopen）本轮会被拒；'
        + '图操作工具两类活动都放行。');
    }
  } else if (role === 'decide') {
    lines.push(`【open steps】${openSteps.length === 0 ? '（无）' : openSteps.map((s) => `${s.id}[${s.priority}]`).join(', ')}`);
    lines.push('【本轮可用图工具】fgs_preview（只读）、fgs_open_step / fgs_drop_step / fgs_change_step_priority / fgs_satisfy_goal / fgs_reopen（记草稿）、fgs_commit（提交）。');
    lines.push('用 fgs_open_step / fgs_drop_step / fgs_satisfy_goal / fgs_reopen 记草稿，最后 fgs_commit 一次性提交。');
    lines.push('环境执行工具（bash/文件/网络/委派类）本轮会被拒。');
  }
  if (draftSummary) lines.push(`【未提交草稿】${draftSummary}`);
  if (ioSpec && (ioSpec.notes.length > 0 || ioSpec.forbidden.length > 0)) {
    const parts = [];
    if (ioSpec.forbidden.length > 0) parts.push(`禁止: ${ioSpec.forbidden.join(', ')}`);
    if (ioSpec.notes.length > 0) parts.push(ioSpec.notes.join('；'));
    lines.push(`【I/O 预制规范（${role}，io-specs/${role}.io.yaml）】${parts.join(' | ')}`);
  }
  lines.push('');
  // Execute 用**因果邻域投影**而不是整张图的完整 YAML：图是只追加的，
  // 原先每个回合都把全图正文重新注入一次，注入量单调增长且无上限（实测被测模型
  // 自己在 reasoning 里抱怨 "the context bloat is a problem"，并据此少碰黑板）。
  // 见 GraphStore.focused() 的详细注释。
  lines.push(role === 'execute'
    ? store.focused(graph, { stepId: currentStep?.id ?? null, maxChars: injectMaxChars })
    : store.preview(graph));
  return lines.join('\n');
}

export function roleLabel(role) {
  if (role === 'decide') return 'Decide（只做规划/改图，禁止环境执行工具）';
  if (role === 'execute') return 'Execute（只推进一个 open step，禁止规划类改图工具）';
  return 'off（未启动 FGS 运行）';
}
