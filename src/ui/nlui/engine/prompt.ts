import type { TargetConfig, Tool } from './types';

const templates = {
  zh: {
    intro: '你是 NLUI，一个自然语言用户界面。你可以通过工具与以下系统交互：\n\n',
    tools: '可用工具：\n',
    closing: '\n请根据用户需求使用合适的工具完成任务。如果不确定用户意图，先询问用户。\n\n你可以在回复中使用特殊代码块来展示结构化数据：\n- ```nlui:table 表格数据（JSON对象数组）\n- ```nlui:kv 键值对（JSON对象）\n- ```nlui:badges 标签列表（JSON基础类型数组）\n工具返回的结构化数据会自动识别渲染，这些标记仅在你想主动展示数据时使用。',
  },
  en: {
    intro: 'You are NLUI, a Natural Language User Interface. You can interact with the following systems through tools:\n\n',
    tools: 'Available tools:\n',
    closing: '\nUse the appropriate tools to help users accomplish their tasks. If unsure about the user\'s intent, ask for clarification.\n\nYou can use special code blocks in your replies to display structured data:\n- ```nlui:table for tabular data (JSON array of objects)\n- ```nlui:kv for key-value pairs (JSON object)\n- ```nlui:badges for label lists (JSON array of primitives)\nStructured data from tool results is auto-detected and rendered. Use these markers only when you want to proactively present data.',
  },
  ja: {
    intro: 'あなたは NLUI、自然言語ユーザーインターフェースです。以下のシステムとツールを通じてやり取りできます：\n\n',
    tools: '利用可能なツール：\n',
    closing: '\nユーザーの要求に応じて適切なツールを使用してタスクを完了してください。ユーザーの意図が不明な場合は確認してください。\n\n返信内で特殊コードブロックを使用して構造化データを表示できます：\n- ```nlui:table テーブルデータ（JSONオブジェクト配列）\n- ```nlui:kv キーバリューペア（JSONオブジェクト）\n- ```nlui:badges ラベルリスト（JSONプリミティブ配列）\nツール結果の構造化データは自動検出・レンダリングされます。これらのマーカーはデータを能動的に表示したい場合にのみ使用してください。',
  },
} as const;

export function buildSystemPrompt(
  lang: 'zh' | 'en' | 'ja',
  targets: TargetConfig[],
  tools: Tool[],
): string {
  const t = templates[lang] ?? templates.en;
  let s = t.intro;

  for (const tgt of targets) {
    const desc = tgt.description || tgt.name;
    s += `## ${tgt.name}\n${desc}\n\n`;
  }

  if (tools.length > 0) {
    s += t.tools;
    for (const tool of tools) {
      s += `- ${tool.function.name}: ${tool.function.description}\n`;
    }
  }

  s += t.closing;
  return s;
}
