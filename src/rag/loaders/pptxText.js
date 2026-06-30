/**
 * PPTX 文本提取
 *
 * 使用 adm-zip 解压 .pptx 文件，提取幻灯片中的文本。
 * .pptx 是 ZIP 包，幻灯片文本存储在 ppt/slides/slide*.xml 中。
 */
import AdmZip from 'adm-zip';

/**
 * 从 .pptx buffer 中提取所有幻灯片文本
 * @param {Buffer} buffer
 * @returns {string}
 */
export function extractPptxText(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // 查找所有幻灯片文件
  const slideEntries = entries
    .filter(e => e.entryName.startsWith('ppt/slides/slide') && e.entryName.endsWith('.xml'))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || '0', 10);
      const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || '0', 10);
      return numA - numB;
    });

  // 提取幻灯片备注
  const notesEntries = entries
    .filter(e => e.entryName.startsWith('ppt/notesSlides/notesSlide') && e.entryName.endsWith('.xml'))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/notesSlide(\d+)/)?.[1] || '0', 10);
      const numB = parseInt(b.entryName.match(/notesSlide(\d+)/)?.[1] || '0', 10);
      return numA - numB;
    });

  // 提取幻灯片母版中的占位符文本（部分内容）
  const slideLayouts = entries
    .filter(e => (e.entryName.startsWith('ppt/slideLayouts/') || e.entryName.startsWith('ppt/slideMasters/')) && e.entryName.endsWith('.xml'));

  // 提取元数据
  const coreXml = entries.find(e => e.entryName === 'docProps/core.xml');
  let title = '';
  if (coreXml) {
    const content = coreXml.getData().toString('utf-8');
    const titleMatch = content.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
    if (titleMatch) title = titleMatch[1];
  }

  const slides = slideEntries.map((entry, i) => {
    const xml = entry.getData().toString('utf-8');
    const text = extractTextFromSlideXml(xml);
    if (!text.trim()) return null;

    // 查找对应的备注
    let notes = '';
    const notesEntry = notesEntries.find(n => {
      const num = parseInt(n.entryName.match(/notesSlide(\d+)/)?.[1] || '0', 10);
      return num === i + 1;
    });
    if (notesEntry) {
      const notesXml = notesEntry.getData().toString('utf-8');
      notes = extractTextFromSlideXml(notesXml).trim();
    }

    let slideContent = `--- Slide ${i + 1} ---`;
    if (notes) slideContent += `\n[Notes: ${notes}]`;
    slideContent += `\n${text.trim()}`;
    return slideContent;
  }).filter(Boolean);

  const result = [`=== Presentation: ${title || 'Untitled'} ===`, `Total slides: ${slides.length}`, ''];
  slides.forEach(s => result.push(s));

  // 检查是否所有 slides 都为空（可能是图表/图片为主的 PPT）
  const allEmpty = slides.every(s => {
    const lines = s.split('\n').filter(l => !l.startsWith('---') && !l.startsWith('[Notes') && !l.startsWith('['));
    return lines.length === 0;
  });

  if (allEmpty) {
    // 尝试从 layout 中提取通用文本
    const layoutTexts = slideLayouts.map(e => extractTextFromSlideXml(e.getData().toString('utf-8'))).filter(Boolean);
    if (layoutTexts.length > 0) {
      result.push('\n[Layout-level text (fallback):]');
      layoutTexts.forEach(t => result.push(t));
    }
  }

  return result.join('\n');
}

/**
 * 从单个幻灯片 XML 中提取文本
 * 提取 <a:t> 标签内容（PowerPoint 文本元素）
 */
function extractTextFromSlideXml(xml) {
  const texts = [];
  // 匹配 <a:t>text content</a:t>
  const regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) texts.push(text);
  }
  return texts.join('\n');
}