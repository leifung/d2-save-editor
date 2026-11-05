#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build metadata for the "add property / add skill" feature.

Sources (all local, no network):
  * ref/d2s/src_data_versions_96_constant_data.ts  -- stat / skill / class tables
  * ref/tbl/zh_*.tbl                               -- official CHS string tables
  * hand-written Chinese stat names for the 239 writable item stats
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_tbl import load_all
import zhconv
import core

BASE = os.path.dirname(os.path.abspath(__file__))
C = core.CONST

# ---------------------------------------------------------------- stat names
# Chinese labels for every stat that can legally be written into an item.
# Keys are the ItemStatCost "Stat" names used by the parser.
PROP_CN = {
    # base attributes / vitals
    'strength': '+力量', 'energy': '+精力', 'dexterity': '+敏捷', 'vitality': '+体力',
    'maxhp': '+生命', 'maxmana': '+法力', 'maxstamina': '+最大耐力',
    # damage / defense
    'item_armor_percent': '增强防御 %', 'item_maxdamage_percent': '增强伤害 %（最小/最大）',
    'tohit': '+准确率', 'toblock': '格挡率 %',
    'mindamage': '+最小伤害（单手）', 'maxdamage': '+最大伤害（单手）',
    'secondary_mindamage': '+最小伤害（双手）', 'secondary_maxdamage': '+最大伤害（双手）',
    'damagepercent': '伤害加成 %', 'manarecovery': '法力恢复 %',
    'manarecoverybonus': '法力回复加成 %', 'staminarecoverybonus': '耐力回复加成 %',
    'armorclass': '+防御', 'armorclass_vs_missile': '+对远程防御',
    'armorclass_vs_hth': '+对近战防御',
    'normal_damage_reduction': '物理伤害减免', 'magic_damage_reduction': '魔法伤害减免',
    'damageresist': '物理抗性 %', 'magicresist': '魔法抗性 %', 'maxmagicresist': '+最大魔法抗性',
    'fireresist': '火焰抗性 %', 'maxfireresist': '+最大火焰抗性',
    'lightresist': '闪电抗性 %', 'maxlightresist': '+最大闪电抗性',
    'coldresist': '冰冷抗性 %', 'maxcoldresist': '+最大冰冷抗性',
    'poisonresist': '毒素抗性 %', 'maxpoisonresist': '+最大毒素抗性',
    'firemindam': '火焰伤害（最小/最大）', 'lightmindam': '闪电伤害（最小/最大）',
    'magicmindam': '魔法伤害（最小/最大）', 'coldmindam': '冰冷伤害（最小/最大/持续）',
    'poisonmindam': '毒素伤害（最小/最大/持续）',
    'lifedrainmindam': '击中偷取生命 %', 'manadrainmindam': '击中偷取法力 %',
    'velocitypercent': '移动速度 %', 'attackrate': '攻击速度 %',
    'value': '物品价值', 'durability': '当前耐久', 'maxdurability': '最大耐久',
    'hpregen': '生命自动回复', 'item_maxdurability_percent': '增加最大耐久 %',
    'item_maxhp_percent': '增加最大生命 %', 'item_maxmana_percent': '增加最大法力 %',
    'item_attackertakesdamage': '攻击者反受伤害', 'item_goldbonus': '金币获取 %',
    'item_magicbonus': '魔法装备掉落 %', 'item_knockback': '击退',
    'item_timeduration': '效果持续时间',
    # skills
    'item_addclassskills': '+职业技能等级', 'item_addexperience': '经验获取 %',
    'item_healafterkill': '击杀后回复生命', 'item_reducedprices': '商人价格降低 %',
    'item_doubleherbduration': '药剂持续时间翻倍', 'item_lightradius': '光照范围',
    'item_lightcolor': '光照颜色（原始值）', 'item_req_percent': '需求降低 %',
    'item_levelreq': '需求等级', 'item_fasterattackrate': '提升攻击速度 %',
    'item_levelreqpct': '需求等级 %', 'item_fastermovevelocity': '提升移动速度 %',
    'item_nonclassskill': '+非职业技能等级', 'state': '状态效果（高级）',
    'item_fastergethitrate': '快速打击恢复 %', 'item_fasterblockrate': '快速格挡 %',
    'item_fastercastrate': '快速施法 %', 'item_singleskill': '+单项技能等级',
    'item_restinpeace': '安息（无法被复活）', 'curse_resistance': '诅咒抗性',
    'item_poisonlengthresist': '毒素持续时间缩短 %', 'item_normaldamage': '+普通伤害',
    'item_howl': '使目标逃跑', 'item_stupidity': '使目标迷惑',
    'item_damagetomana': '伤害转化为法力 %', 'item_ignoretargetac': '无视目标防御',
    'item_fractionaltargetac': '降低目标防御 %', 'item_preventheal': '阻止怪物治疗',
    'item_halffreezeduration': '冰冻时间减半', 'item_tohit_percent': '准确率提升 %',
    'item_damagetargetac': '对目标防御加成', 'item_demondamage_percent': '对恶魔伤害 %',
    'item_undeaddamage_percent': '对不死伤害 %', 'item_demon_tohit': '对恶魔准确率',
    'item_undead_tohit': '对不死准确率', 'item_throwable': '可投掷',
    'item_elemskill': '+元素技能等级', 'item_allskills': '+所有技能等级',
    'item_attackertakeslightdamage': '攻击者反受闪电伤害',
    'item_freeze': '冻结目标', 'item_openwounds': '撕裂伤口 %',
    'item_crushingblow': '压碎打击 %', 'item_kickdamage': '+踢击伤害',
    'item_manaafterkill': '击杀后回复法力', 'item_healafterdemonkill': '击杀恶魔后回复生命',
    'item_extrablood': '额外血腥效果', 'item_deadlystrike': '致命攻击 %',
    'item_absorbfire_percent': '火焰吸收 %', 'item_absorbfire': '火焰吸收（固定）',
    'item_absorblight_percent': '闪电吸收 %', 'item_absorblight': '闪电吸收（固定）',
    'item_absorbmagic_percent': '魔法吸收 %', 'item_absorbmagic': '魔法吸收（固定）',
    'item_absorbcold_percent': '冰冷吸收 %', 'item_absorbcold': '冰冷吸收（固定）',
    'item_slow': '减速目标 %', 'item_aura': '赋予灵气（高级）',
    'item_indesctructible': '无法破坏', 'item_cannotbefrozen': '无法被冻结',
    'item_staminadrainpct': '耐力消耗 %', 'item_reanimate': '复活怪物（高级）',
    'item_pierce': '穿透 %', 'item_magicarrow': '魔法箭',
    'item_explosivearrow': '爆裂箭', 'item_throw_mindamage': '投掷最小伤害',
    'item_throw_maxdamage': '投掷最大伤害',
    'attack_vs_montype': '对特定怪物准确率（高级）',
    'damage_vs_montype': '对特定怪物伤害（高级）', 'fade': '渐隐（内部）',
    'item_addskill_tab': '+技能系等级', 'item_numsockets': '增加孔数',
    'item_skillonattack': '攻击时施放技能', 'item_skillonkill': '击杀时施放技能',
    'item_skillondeath': '死亡时施放技能', 'item_skillonhit': '命中时施放技能',
    'item_skillonlevelup': '升级时施放技能', 'item_skillongethit': '受击时施放技能',
    'item_charged_skill': '充能技能',
    # per-level
    'item_armor_perlevel': '每级 +防御', 'item_armorpercent_perlevel': '每级 增强防御 %',
    'item_hp_perlevel': '每级 +生命', 'item_mana_perlevel': '每级 +法力',
    'item_maxdamage_perlevel': '每级 +最大伤害',
    'item_maxdamage_percent_perlevel': '每级 增强伤害 %',
    'item_strength_perlevel': '每级 +力量', 'item_dexterity_perlevel': '每级 +敏捷',
    'item_energy_perlevel': '每级 +精力', 'item_vitality_perlevel': '每级 +体力',
    'item_tohit_perlevel': '每级 +准确率', 'item_tohitpercent_perlevel': '每级 准确率 %',
    'item_cold_damagemax_perlevel': '每级 +冰冷最大伤害',
    'item_fire_damagemax_perlevel': '每级 +火焰最大伤害',
    'item_ltng_damagemax_perlevel': '每级 +闪电最大伤害',
    'item_pois_damagemax_perlevel': '每级 +毒素最大伤害',
    'item_resist_cold_perlevel': '每级 冰冷抗性 %', 'item_resist_fire_perlevel': '每级 火焰抗性 %',
    'item_resist_ltng_perlevel': '每级 闪电抗性 %', 'item_resist_pois_perlevel': '每级 毒素抗性 %',
    'item_absorb_cold_perlevel': '每级 冰冷吸收', 'item_absorb_fire_perlevel': '每级 火焰吸收',
    'item_absorb_ltng_perlevel': '每级 闪电吸收', 'item_absorb_pois_perlevel': '每级 毒素吸收',
    'item_thorns_perlevel': '每级 荆棘伤害', 'item_find_gold_perlevel': '每级 金币获取 %',
    'item_find_magic_perlevel': '每级 魔法装备掉落 %',
    'item_regenstamina_perlevel': '每级 耐力回复', 'item_stamina_perlevel': '每级 +耐力',
    'item_damage_demon_perlevel': '每级 对恶魔伤害 %',
    'item_damage_undead_perlevel': '每级 对不死伤害 %',
    'item_tohit_demon_perlevel': '每级 对恶魔准确率',
    'item_tohit_undead_perlevel': '每级 对不死准确率',
    'item_crushingblow_perlevel': '每级 压碎打击 %',
    'item_openwounds_perlevel': '每级 撕裂伤口 %',
    'item_kick_damage_perlevel': '每级 +踢击伤害',
    'item_deadlystrike_perlevel': '每级 致命攻击 %',
    'item_replenish_durability': '自动回复耐久', 'item_replenish_quantity': '自动补充数量',
    'item_extra_stack': '额外堆叠数量',
    # by-time (advanced)
    'item_armor_bytime': '随时间 +防御（高级）',
    'item_armorpercent_bytime': '随时间 增强防御 %（高级）',
    'item_hp_bytime': '随时间 +生命（高级）', 'item_mana_bytime': '随时间 +法力（高级）',
    'item_maxdamage_bytime': '随时间 +最大伤害（高级）',
    'item_maxdamage_percent_bytime': '随时间 增强伤害 %（高级）',
    'item_strength_bytime': '随时间 +力量（高级）',
    'item_dexterity_bytime': '随时间 +敏捷（高级）',
    'item_energy_bytime': '随时间 +精力（高级）',
    'item_vitality_bytime': '随时间 +体力（高级）',
    'item_tohit_bytime': '随时间 +准确率（高级）',
    'item_tohitpercent_bytime': '随时间 准确率 %（高级）',
    'item_cold_damagemax_bytime': '随时间 +冰冷最大伤害（高级）',
    'item_fire_damagemax_bytime': '随时间 +火焰最大伤害（高级）',
    'item_ltng_damagemax_bytime': '随时间 +闪电最大伤害（高级）',
    'item_pois_damagemax_bytime': '随时间 +毒素最大伤害（高级）',
    'item_resist_cold_bytime': '随时间 冰冷抗性 %（高级）',
    'item_resist_fire_bytime': '随时间 火焰抗性 %（高级）',
    'item_resist_ltng_bytime': '随时间 闪电抗性 %（高级）',
    'item_resist_pois_bytime': '随时间 毒素抗性 %（高级）',
    'item_absorb_cold_bytime': '随时间 冰冷吸收（高级）',
    'item_absorb_fire_bytime': '随时间 火焰吸收（高级）',
    'item_absorb_ltng_bytime': '随时间 闪电吸收（高级）',
    'item_absorb_pois_bytime': '随时间 毒素吸收（高级）',
    'item_find_gold_bytime': '随时间 金币获取 %（高级）',
    'item_find_magic_bytime': '随时间 魔法装备掉落 %（高级）',
    'item_regenstamina_bytime': '随时间 耐力回复（高级）',
    'item_stamina_bytime': '随时间 +耐力（高级）',
    'item_damage_demon_bytime': '随时间 对恶魔伤害 %（高级）',
    'item_damage_undead_bytime': '随时间 对不死伤害 %（高级）',
    'item_tohit_demon_bytime': '随时间 对恶魔准确率（高级）',
    'item_tohit_undead_bytime': '随时间 对不死准确率（高级）',
    'item_crushingblow_bytime': '随时间 压碎打击 %（高级）',
    'item_openwounds_bytime': '随时间 撕裂伤口 %（高级）',
    'item_kick_damage_bytime': '随时间 +踢击伤害（高级）',
    'item_deadlystrike_bytime': '随时间 致命攻击 %（高级）',
    'item_pierce_cold': '降低冰冷抗性 %', 'item_pierce_fire': '降低火焰抗性 %',
    'item_pierce_ltng': '降低闪电抗性 %', 'item_pierce_pois': '降低毒素抗性 %',
    'item_extra_charges': '额外充能次数',
    # passive / class-only
    'passive_fire_mastery': '火焰支配 %（被动）', 'passive_ltng_mastery': '闪电支配 %（被动）',
    'passive_cold_mastery': '冰冷支配 %（被动）', 'passive_pois_mastery': '毒素支配 %（被动）',
    'passive_fire_pierce': '降低敌人火焰抗性 %（被动）',
    'passive_ltng_pierce': '降低敌人闪电抗性 %（被动）',
    'passive_cold_pierce': '降低敌人冰冷抗性 %（被动）',
    'passive_pois_pierce': '降低敌人毒素抗性 %（被动）',
    'passive_critical_strike': '致命攻击 %（被动）', 'passive_dodge': '闪避 %（被动）',
    'passive_avoid': '躲避 %（被动）', 'passive_evade': '回避 %（被动）',
    'passive_warmth': '热情（被动）', 'passive_mastery_melee_th': '近战准确率 %（被动）',
    'passive_mastery_melee_dmg': '近战伤害 %（被动）',
    'passive_mastery_melee_crit': '近战致命 %（被动）',
    'passive_mastery_throw_th': '投掷准确率 %（被动）',
    'passive_mastery_throw_dmg': '投掷伤害 %（被动）',
    'passive_mastery_throw_crit': '投掷致命 %（被动）',
    'passive_weaponblock': '武器格挡 %（被动）',
    'passive_summon_resist': '召唤物抗性 %（被动）',
    'questitemdifficulty': '任务物品难度（内部）',
    'passive_mag_mastery': '魔法支配 %（被动）',
    'passive_mag_pierce': '降低敌人魔法抗性 %（被动）',
    # np-group members (shown when the group is expanded in the form)
    'item_mindamage_percent': '增强最小伤害 %', 'firemaxdam': '火焰最大伤害',
    'lightmaxdam': '闪电最大伤害', 'magicmaxdam': '魔法最大伤害',
    'coldmaxdam': '冰冷最大伤害', 'coldlength': '冰冷持续时间',
    'poisonmaxdam': '毒素最大伤害', 'poisonlength': '毒素持续时间',
    'lifedrainmaxdam': '击中偷取生命 %（最大）',
    'manadrainmaxdam': '击中偷取法力 %（最大）',
}

# ---------------------------------------------------------------- categories
SKILL_IDS = [83, 97, 107, 126, 127, 151, 188, 195, 196, 197, 198, 199, 201, 204]
COMMON_IDS = [
    0, 1, 2, 3, 7, 9, 16, 19, 20, 21, 22, 31, 39, 41, 43, 45,
    60, 62, 73, 74, 75, 76, 77, 79, 80, 85, 86, 89, 91, 93, 96,
    99, 102, 105, 110, 111, 114, 115, 118, 119, 121, 122,
    127, 135, 136, 138, 141, 142, 144, 146, 148, 150, 153, 156,
    194, 305, 306, 307, 308,
]

def cat_of(pid, prop):
    if pid in SKILL_IDS: return 'skill'
    if pid in COMMON_IDS: return 'common'
    if prop.get('sP') or prop.get('e') == 4 or pid >= 329: return 'advanced'
    if 214 <= pid <= 303: return 'advanced'
    return 'other'

# ---------------------------------------------------------------- skill names
T = load_all()

EN_PAREN = re.compile(r'\s*[（(]([A-Za-z][A-Za-z \-\'&/]*)[)）]\s*$')

def clean_cn(s):
    if not s: return None
    s = s.replace('\r', ' ').replace('\n', ' ').strip()
    s = zhconv.convert(s, 'zh-cn')
    s = EN_PAREN.sub('', s)          # CHS patch appends "(English Name)"
    s = re.sub(r'\s+', ' ', s).strip()
    if not s or not re.search(r'[\u4e00-\u9fff]', s): return None
    if len(s) > 24: return None
    return s

def norm_en(s):
    return (s or '').lower().replace(' ', '')

# The TBL "skillname<N>" numbering does NOT always equal the save-file skill id
# (e.g. druid/assassin skills are shifted by one). Luckily the CHS patch kept
# the English name in parentheses, so match by name instead of by index.
BY_EN = {}
IDX_EN = {}
for k, v in T.items():
    m = re.match(r'^skillname(\d+)$', k)
    if not m: continue
    g = EN_PAREN.search(v)
    cn = clean_cn(v)
    if not cn: continue
    n = int(m.group(1))
    if g:
        key = norm_en(g.group(1))
        BY_EN.setdefault(key, cn)
        IDX_EN[n] = key
    elif n not in IDX_EN:
        IDX_EN[n] = None

skills = C['skills']
skills_en, skills_cn, skill_class = [], [], []
for i, d in enumerate(skills):
    en = (d or {}).get('s') or None
    c = BY_EN.get(norm_en(en))
    # For ids < 217 the TBL numbering is aligned; use it for entries where the
    # CHS patch did not keep an English name (Kick, Throw, tomes, ...).
    if not c and i < 217:
        c = clean_cn(T.get('skillname%d' % i))
    skills_en.append(en)
    skills_cn.append(c)
    skill_class.append((d or {}).get('c') or '')

# ---------------------------------------------------------------- classes/tabs
CLASSES_CN = ['亚马逊', '法师', '死灵法师', '圣骑士', '野蛮人', '德鲁伊', '刺客']
TABS_CN = [
    ['弓与弩技能', '被动与魔法技能', '标枪与长矛技能'],
    ['火焰技能', '闪电技能', '冰冷技能'],
    ['诅咒', '毒素与白骨技能', '召唤技能'],
    ['防御性灵气', '攻击性灵气', '战斗技能'],
    ['战斗技能', '武器支配', '战吼'],
    ['元素技能', '变形技能', '召唤技能'],
    ['武学技能', '影子训练', '陷阱'],
]
classes_en = [(d or {}).get('n') or ('职业%d' % i) for i, d in enumerate(C['classes'])]

# ---------------------------------------------------------------- build list
blocked = set()
for i, p in enumerate(C['magical_properties']):
    if p and p.get('np', 1) > 1:
        for j in range(1, p['np']): blocked.add(i + j)

addable = []
for i, p in enumerate(C['magical_properties']):
    if not p or not p.get('sB') or i in blocked: continue
    np_ = p.get('np', 1)
    if i + np_ - 1 >= len(C['magical_properties']): continue
    if not all(C['magical_properties'][i + j] and C['magical_properties'][i + j].get('sB')
               for j in range(np_)): continue
    members = []
    for j in range(np_):
        q = C['magical_properties'][i + j]
        members.append({
            'id': i + j, 's': q['s'], 'cn': PROP_CN.get(q['s']) or q['s'],
            'sB': q['sB'], 'sA': q.get('sA', 0), 'sP': q.get('sP', 0),
            'e': q.get('e', 0), 'dF': q.get('dF', 0),
        })
    addable.append({
        'id': i, 's': p['s'], 'cn': PROP_CN.get(p['s']) or p['s'],
        'cat': cat_of(i, p), 'np': np_, 'members': members,
    })

out = {
    'prop_cn': PROP_CN,
    'addable': addable,
    'skills_en': skills_en,
    'skills_cn': skills_cn,
    'skill_class': skill_class,
    'classes_en': classes_en,
    'classes_cn': CLASSES_CN,
    'tabs_cn': TABS_CN,
}
path = os.path.join(BASE, 'add_meta.json')
s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
open(path, 'w', encoding='utf-8').write(s)

print('wrote %s  %d bytes' % (path, len(s)))
print('  addable stats : %d' % len(addable))
print('  zh stat names : %d / %d group-start stats' % (
    sum(1 for a in addable if a['cn'] != a['s']), len(addable)))
print('  skills        : %d  (zh %d)' % (len(skills_cn), sum(1 for x in skills_cn if x)))
for i in (1, 6, 54, 64, 132, 220, 221, 222, 225, 250, 251):
    print('    %3d %-24s -> %s' % (i, skills_en[i], skills_cn[i]))
print('  classes       : %s' % ', '.join(CLASSES_CN))
