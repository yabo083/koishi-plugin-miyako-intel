"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStoryAnchorFromMission = createStoryAnchorFromMission;
exports.createWarfarinAnchorsFromDetail = createWarfarinAnchorsFromDetail;
function createStoryAnchorFromMission(slug, data) {
    const texts = [];
    const fullText = [];
    const mission = data?.mission || {};
    for (const value of [mission.name, mission.description]) {
        const text = stripTags(value || '');
        if (text)
            texts.push(text);
    }
    // 新版 detail 用 transcript[] 分段（line/choice 两类 item）；旧 dialog[] 仍保留兼容
    for (const segment of Array.isArray(data?.transcript) ? data.transcript : []) {
        for (const item of Array.isArray(segment?.items) ? segment.items : []) {
            if (item?.type === 'choice') {
                for (const option of Array.isArray(item?.options) ? item.options : []) {
                    const text = stripTags(option?.text || '');
                    if (!text)
                        continue;
                    texts.push(`选项：${text}`);
                    fullText.push({ speaker: '选项', text });
                }
                continue;
            }
            const text = stripTags(item?.text || '');
            if (!text)
                continue;
            const speaker = stripTags(item?.speaker || '') || '旁白';
            texts.push(`${speaker}：${text}`);
            fullText.push({ speaker, text });
        }
    }
    for (const entry of Array.isArray(data?.dialog) ? data.dialog : []) {
        const text = stripTags(entry?.dialogText || entry?.optionText || '');
        if (!text)
            continue;
        const speaker = entry?.optionText ? '选项' : stripTags(entry?.actorName || '') || '旁白';
        texts.push(`${speaker}：${text}`);
        fullText.push({ speaker, text });
    }
    for (const radio of sortRadios(data?.radios)) {
        for (const message of sortRadioMessages(radio?.messages)) {
            const text = stripTags(message?.text || message?.radioText || '');
            if (!text)
                continue;
            const speaker = stripTags(message?.speaker || message?.actorName || '') || '通讯';
            texts.push(`通讯中 / ${speaker}：${text}`);
            fullText.push({ scene: '通讯中', speaker, text });
        }
    }
    const name = stripTags(mission.name || '') || slug;
    const source = `任务剧情：${name}`;
    return {
        anchor_id: `${slug}_0`,
        content: texts.join('\n'),
        source,
        source_ref: source,
        scope: 'missions',
        relevance: 1,
        full_text: fullText,
    };
}
function createWarfarinAnchorsFromDetail(category, slug, data) {
    const scope = normalizeScope(category);
    if (scope === 'missions')
        return [createStoryAnchorFromMission(slug, data)];
    if (scope === 'baker')
        return createBakerAnchors(slug, data);
    if (scope === 'tutorials')
        return createTutorialAnchors(slug, data);
    if (scope === 'enemies')
        return createEnemyAnchors(slug, data);
    if (scope === 'medals')
        return createMedalAnchors(slug, data);
    if (scope === 'documents')
        return createRichContentAnchors(slug, data, scope, '中枢档案');
    if (scope === 'lore')
        return createRichContentAnchors(slug, data, scope, '见闻辑录');
    if (scope === 'operators')
        return createOperatorAnchors(slug, data);
    if (scope === 'weapons')
        return createItemLikeAnchors(slug, data, scope, '武器资料');
    if (scope === 'facilities')
        return createItemLikeAnchors(slug, data, scope, '设备信息');
    if (scope === 'items')
        return createItemLikeAnchors(slug, data, scope, '物品信息');
    if (scope === 'gear')
        return createItemLikeAnchors(slug, data, scope, '装备信息');
    return createGenericAnchors(slug, data, scope);
}
function createBakerAnchors(slug, data) {
    const rows = [];
    const metadata = [];
    const speakerMap = new Map([['endmin', '管理员']]);
    for (const [id, chat] of Object.entries(data?.SNSChatTable || {})) {
        const name = stripTags(chat?.name || '');
        if (name)
            speakerMap.set(id, name);
        if (name)
            metadata.push(`角色：${name}`);
        const desc = stripTags(chat?.desc || '');
        if (desc)
            metadata.push(`简介：${desc}`);
    }
    const optionTable = data?.SNSDialogOptionTable || {};
    for (const dialog of Object.values(data?.SNSDialogTable || {})) {
        const contentData = dialog?.dialogContentData;
        if (!contentData || typeof contentData !== 'object')
            continue;
        const entries = Object.values(contentData).sort((a, b) => Number(a?.contentId || 0) - Number(b?.contentId || 0));
        for (const entry of entries) {
            const speaker = speakerMap.get(String(entry?.speaker || '')) || stripTags(entry?.speaker || '') || '旁白';
            const text = stripTags(entry?.content || '');
            if (text)
                rows.push({ speaker, text });
            const optionTexts = [];
            for (const optionId of Array.isArray(entry?.dialogOptionIds) ? entry.dialogOptionIds : []) {
                const optionText = stripTags(optionTable?.[optionId]?.optionDesc || '');
                if (optionText)
                    optionTexts.push(optionText);
            }
            if (optionTexts.length)
                rows.push({ speaker: '选项', text: optionTexts.join(' | ') });
        }
    }
    const name = stripTags(data?.summary?.name || data?.SNSDialogTopicTable?.topicName || '') || slug;
    return [makeStoryAnchor(slug, 0, [...metadata, ...rows.map(row => `${row.speaker}：${row.text}`)].join('\n'), `Baker对话：${name}`, 'baker', rows)];
}
function createTutorialAnchors(slug, data) {
    const texts = [];
    for (const page of Object.values(data?.wikiTutorialPageTable || {})) {
        texts.push(...extractFromTable(page, 'title', 'content'));
    }
    const name = firstText(Object.values(data?.wikiTutorialPageTable || {}).map((page) => page?.title)) || slug;
    return [makeStoryAnchor(slug, 0, texts.join('\n'), `教程：${name}`, 'tutorials')];
}
function createEnemyAnchors(slug, data) {
    const display = data?.enemyTemplateDisplayInfoTable || {};
    const texts = [...extractFromTable(display, 'name', 'description', 'nickname')];
    for (const entry of Object.values(data?.enemyAbilityDescTable || {})) {
        texts.push(...extractFromTable(entry, 'name', 'description'));
    }
    const name = stripTags(display?.name || '') || slug;
    return [makeStoryAnchor(slug, 0, texts.join('\n'), `敌人资料：${name}`, 'enemies')];
}
function createMedalAnchors(slug, data) {
    const ach = data?.achievementTable || {};
    const texts = [...extractFromTable(ach, 'name', 'desc', 'completeDesc')];
    for (const level of Object.values(ach?.levelInfos || {})) {
        texts.push(...extractFromTable(level, 'completeDesc'));
        for (const cond of Array.isArray(level?.conditions) ? level.conditions : []) {
            texts.push(...extractFromTable(cond, 'desc'));
        }
    }
    texts.push(...extractFromTable(data?.achievementTypeTable, 'categoryName'));
    const group = Array.isArray(data?.achievementTypeTable?.achievementGroupData)
        ? data.achievementTypeTable.achievementGroupData.find((item) => item?.groupId === ach?.groupId)
        : undefined;
    texts.push(...extractFromTable(group, 'groupName'));
    const name = stripTags(ach?.name || '') || slug;
    return [makeStoryAnchor(slug, 0, texts.join('\n'), `奖章信息：${name}`, 'medals')];
}
function createRichContentAnchors(slug, data, scope, label) {
    const texts = [];
    for (const entry of Array.isArray(data?.richContentTable?.contentList) ? data.richContentTable.contentList : []) {
        texts.push(...extractFromTable(entry, 'content'));
    }
    texts.push(...extractFromTable(data?.prtsAllItem, 'desc'));
    const name = stripTags(data?.richContentTable?.title || data?.prtsDocument?.name || data?.prtsAllItem?.name || '') || slug;
    return [makeStoryAnchor(slug, 0, texts.join('\n\n'), `${label}：${name}`, scope)];
}
// characterTable.profileRecord / profileVoice 都是对象数组（档案分卷、语音条目），
// 直接丢进字符串会得到 "[object Object]"。按分卷/语音各自拼行，并用空行分节，
// 转发时才能按源站章节切节点。
function createOperatorAnchors(slug, data) {
    const character = data?.characterTable || {};
    const sections = [];
    const intro = extractFromTable(data?.itemTable, 'name', 'desc', 'decoDesc');
    if (intro.length)
        sections.push(intro.join('\n'));
    for (const record of objectList(character.profileRecord)) {
        const title = stripTags(record.recordTitle);
        const text = stripTags(record.recordDesc);
        if (!text)
            continue;
        sections.push(title ? `${title}：${text}` : text);
    }
    const voices = objectList(character.profileVoice).map((voice) => {
        const title = stripTags(voice.voiceTitle);
        const text = stripTags(voice.voiceDesc);
        return text ? (title ? `${title}：${text}` : text) : '';
    }).filter(Boolean);
    if (voices.length)
        sections.push(['语音记录', ...voices].join('\n'));
    const name = stripTags(data?.itemTable?.name || character.name || '') || slug;
    return [makeStoryAnchor(slug, 0, sections.join('\n\n'), `干员资料：${name}`, 'operators')];
}
function objectList(value) {
    return Array.isArray(value)
        ? value.filter((item) => !!item && typeof item === 'object' && !Array.isArray(item))
        : [];
}
function createItemLikeAnchors(slug, data, scope, label) {
    if (scope === 'items' && isAchievementItem(data?.itemTable))
        return [];
    const texts = [
        ...extractFromTable(data?.itemTable, 'name', 'desc', 'decoDesc'),
        ...extractFromTable(data?.factoryBuildingTable, 'name', 'desc'),
    ];
    const name = stripTags(data?.itemTable?.name || data?.factoryBuildingTable?.name || '') || slug;
    return [makeStoryAnchor(slug, 0, texts.join('\n'), `${label}：${name}`, scope)];
}
function isAchievementItem(item) {
    const id = String(item?.id || '').trim();
    return id.startsWith('achv_');
}
function createGenericAnchors(slug, data, scope) {
    const texts = collectTexts(data).map(stripTags).filter(Boolean);
    return [makeStoryAnchor(slug, 0, texts.join('\n'), `资料：${slug}`, scope)];
}
function makeStoryAnchor(slug, index, content, source, scope, fullText) {
    const text = String(content || '').trim();
    return {
        anchor_id: `${slug}_${index}`,
        content: text,
        source,
        source_ref: source,
        scope,
        relevance: 1,
        url: `https://warfarin.wiki/cn/${pagePathForScope(scope)}/${encodeURIComponent(slug)}`,
        full_text: fullText?.length ? fullText : (text ? [{ speaker: '资料', text }] : []),
    };
}
function extractFromTable(obj, ...fields) {
    const results = [];
    if (!obj || typeof obj !== 'object')
        return results;
    for (const field of fields) {
        const text = stripTags(obj[field] || '');
        if (text)
            results.push(text);
    }
    return results;
}
function collectTexts(obj, depth = 0) {
    if (depth > 20)
        return [];
    if (typeof obj === 'string')
        return [obj];
    if (!obj || typeof obj !== 'object')
        return [];
    return Object.values(obj).flatMap(value => collectTexts(value, depth + 1));
}
function firstText(values) {
    for (const value of values) {
        const text = stripTags(value || '');
        if (text)
            return text;
    }
    return '';
}
function normalizeScope(category) {
    const scope = String(category || '').trim().toLowerCase();
    return scope === 'lorev2' ? 'lore' : scope;
}
function pagePathForScope(scope) {
    if (scope === 'documents')
        return 'lore';
    return scope === 'lore' ? 'lore' : scope;
}
function sortRadios(radios) {
    return (Array.isArray(radios) ? [...radios] : []).sort((a, b) => naturalKey(a?.radioId).localeCompare(naturalKey(b?.radioId)));
}
function sortRadioMessages(messages) {
    return (Array.isArray(messages) ? [...messages] : []).sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0));
}
function naturalKey(value) {
    return String(value || '').replace(/\d+/g, (part) => part.padStart(8, '0'));
}
// 只接受标量：对象/数组直接 String() 会得到 "[object Object]"，宁可丢弃也不能污染正文。
function stripTags(text) {
    if (typeof text !== 'string' && typeof text !== 'number')
        return '';
    return String(text).replace(/<image>[^<]*<\/image>/gi, '').replace(/<[^>]*>/g, '').trim();
}
