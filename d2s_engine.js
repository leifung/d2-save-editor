/* =========================================================================
 * d2s_engine.js — Diablo II 1.13c (.d2s) parse / in-place edit engine
 *
 * Faithful JS port of dschu012/d2s read logic (verified bit-exact against the
 * real 1.13c saves: parses to exact EOF, checksum matches).
 *
 * Design: parse() records a bit-level ANCHOR for every editable numeric field.
 * applyEdits() rewrites ONLY those bit ranges in a copy of the original bytes,
 * then recomputes filesize + checksum. No structural re-serialization -> every
 * unknown byte is preserved, file length never changes.
 *
 * All bit math uses multiplication/division instead of << / >> so 32-bit
 * fields (experience) never overflow JS's signed 32-bit operators.
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.D2SEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ITEM_TYPE = { Armor: 1, Shield: 2, Weapon: 3, Other: 4 };
  var QUALITY = { Low: 1, Normal: 2, Superior: 3, Magic: 4, Set: 5, Rare: 6, Unique: 7, Crafted: 8 };
  var QUALITY_CN = { 0: '普通', 1: '低品质', 2: '普通', 3: '超强', 4: '魔法', 5: '套装', 6: '稀有', 7: '暗金', 8: '手工' };

  var ATTR_LABEL = {
    0: ['力量', 'Strength'], 1: ['精力', 'Energy'], 2: ['敏捷', 'Dexterity'], 3: ['体力', 'Vitality'],
    4: ['未分配属性点', 'Stat Pts'], 5: ['未分配技能点', 'Skill Pts'],
    6: ['当前生命', 'Current HP'], 7: ['最大生命', 'Max HP'],
    8: ['当前法力', 'Current Mana'], 9: ['最大法力', 'Max Mana'],
    10: ['当前耐力', 'Current Stamina'], 11: ['最大耐力', 'Max Stamina'],
    12: ['角色等级', 'Level'], 13: ['经验值', 'Experience'],
    14: ['身上金币', 'Gold'], 15: ['仓库金币', 'Stashed Gold']
  };

  // Chinese names for magical properties (covers all stats appearing in the
  // reference save plus the most common ones). Falls back to the English id.
  var PROP_CN = {
    strength: '力量', energy: '精力', dexterity: '敏捷', vitality: '体力',
    statpts: '属性点', newskills: '技能点', hitpoints: '生命', maxhp: '最大生命',
    mana: '法力', maxmana: '最大法力', stamina: '耐力', maxstamina: '最大耐力',
    level: '等级', experience: '经验', gold: '金币', goldbank: '仓库金币',
    armorclass: '防御值', armorclass_vs_hth: '对近战防御', armorclass_vs_missile: '对远程防御',
    tohit: '准确率(AR)', toblock: '格挡率', mindamage: '最小伤害', maxdamage: '最大伤害',
    secondary_mindamage: '副手最小伤害', secondary_maxdamage: '副手最大伤害',
    item_armor_percent: '增强防御 %', item_maxdamage_percent: '增强最大伤害 %',
    item_mindamage_percent: '增强最小伤害 %', item_armor_perlevel: '每级增加防御',
    item_hp_perlevel: '每级增加生命', item_maxhp_percent: '增加最大生命 %',
    item_maxmana_percent: '增加最大法力 %', item_armor_percent_total: '总防御增强 %',
    normal_damage_reduction: '物理伤害减免', magic_damage_reduction: '魔法伤害减免',
    damageresist: '物理抗性 %', magicresist: '魔法抗性 %', maxmagicresist: '最大魔法抗性',
    fireresist: '火焰抗性', maxfireresist: '最大火焰抗性',
    lightresist: '闪电抗性', maxlightresist: '最大闪电抗性',
    coldresist: '冰冷抗性', maxcoldresist: '最大冰冷抗性',
    poisonresist: '毒素抗性', maxpoisonresist: '最大毒素抗性',
    firemindam: '火焰伤害(最小)', firemaxdam: '火焰伤害(最大)',
    lightmindam: '闪电伤害(最小)', lightmaxdam: '闪电伤害(最大)',
    magicmindam: '魔法伤害(最小)', magicmaxdam: '魔法伤害(最大)',
    coldmindam: '冰冷伤害(最小)', coldmaxdam: '冰冷伤害(最大)', coldlength: '冰冷持续时间',
    poisonmindam: '毒素伤害(最小)', poisonmaxdam: '毒素伤害(最大)', poisonlength: '毒素持续时间',
    lifedrainmindam: '击中偷取生命', lifedrainmaxdam: '击中偷取生命(最大)',
    manadrainmindam: '击中偷取法力', manadrainmaxdam: '击中偷取法力(最大)',
    hpregen: '生命自动回复', manarecovery: '法力回复加成', hpregen_max: '生命回复',
    maxdurability: '最大耐久', durability: '当前耐久', item_replenish_durability: '自动回复耐久',
    velocitypercent: '攻击速度', attackrate: '攻击速度', item_fasterattackrate: '提升攻击速度 %',
    item_fastermovevelocity: '提升移动速度 %', item_fastergethitrate: '快速打击恢复 %',
    item_fasterblockrate: '快速格挡 %', item_fastercastrate: '快速施法 %',
    item_attackertakesdamage: '攻击者反受伤害', item_goldbonus: '金币获取 %',
    item_magicbonus: '魔法装备掉落 %', item_knockback: '击退',
    item_addclassskills: '职业技能等级', item_addexperience: '经验获取 %',
    item_healafterkill: '击杀后回复生命', item_reducedprices: '商人价格降低 %',
    item_lightradius: '光照范围', item_req_percent: '需求降低 %',
    item_allskills: '所有技能等级', item_singleskill: '单项技能等级',
    item_nonclassskill: '非职业技能等级', item_addskill_tab: '技能系等级',
    item_numsockets: '增加孔数', item_tohit_percent: '准确率提升 %',
    item_damagetargetac: '对目标防御加成', item_damagetomana: '伤害转化为法力',
    item_ignoretargetac: '无视目标防御', item_preventheal: '阻止怪物治疗',
    item_howl: '使目标逃跑', item_stupidity: '使目标迷惑', item_freeze: '冻结目标',
    item_openwounds: '撕裂伤口', item_crushingblow: '压碎打击', item_deadlystrike: '致命攻击',
    item_slow: '减速目标', item_cannotbefrozen: '无法被冻结', item_staminadrainpct: '耐力消耗',
    item_pierce: '穿透', item_magicarrow: '魔法箭', item_explosivearrow: '爆裂箭',
    item_throw_mindamage: '投掷最小伤害', item_throw_maxdamage: '投掷最大伤害',
    item_normaldamage: '普通伤害', item_demondamage_percent: '对恶魔伤害 %',
    item_undeaddamage_percent: '对不死伤害 %', item_absorbfire_percent: '火焰吸收 %',
    item_absorblight_percent: '闪电吸收 %', item_absorbcold_percent: '冰冷吸收 %',
    item_absorbmagic_percent: '魔法吸收 %', item_find_magic_perlevel: '每级魔法装备掉落',
    item_find_gold_perlevel: '每级金币获取', item_skillonattack: '攻击时施放技能',
    item_skillonhit: '命中时施放技能', item_skillongethit: '受击时施放技能',
    item_skillondeath: '死亡时施放技能', item_skillonlevelup: '升级时施放技能',
    item_charged_skill: '充能技能', item_skillonstriking: '打击时施放技能',
    item_state: '状态效果', item_curse_resistance: '诅咒抗性',
    item_kickdamage: '踢击伤害', item_replenish_life: '自动回复生命',
    item_replenish_mana: '自动回复法力', item_lowerreq: '降低需求',
    passive_fire_mastery: '火焰支配', passive_lightning_mastery: '闪电支配',
    passive_cold_mastery: '冰冷支配', passive_poison_mastery: '毒素支配',
    passive_critical_strike: '致命攻击(被动)', passive_pierce: '穿透(被动)',
    item_mindamage_percent: '增强最小伤害 %', item_maxdamage_percent: '增强最大伤害 %'
  };
  function propCN(name, data) {
    return PROP_CN[name] || (data && data.add && data.add.prop_cn && data.add.prop_cn[name]) || null;
  }

  function makeEngine(DATA) {
    var MP = DATA.mp;
    var ARMOR = DATA.armor, WEAPON = DATA.weapon, OTHER = DATA.other;
    var STACK = {}; DATA.stackables.forEach(function (k) { STACK[k] = 1; });
    var CLASSES = DATA.classes;
    var CN = DATA.cn || {};

    // Simplified-Chinese names extracted from the CHS game's string tables.
    function cn(map, en) {
      if (!en) return null;
      var m = CN[map];
      return (m && m[en]) || null;
    }

    function itemTxt(t) {
      return ARMOR[t] || WEAPON[t] || OTHER[t] || null;
    }
    function itemName(t) {
      var d = itemTxt(t);
      return d && d.n ? d.n : t;
    }
    function itemNameCN(t) {
      return (CN.item && CN.item[t]) || null;
    }

    // ---------------- BitReader ----------------
    function Reader(buf) {
      this.buf = buf; this.nbits = buf.length * 8; this.off = 0; this.fields = [];
    }
    Reader.prototype.bit = function (i) {
      if (i >= this.nbits) return 0;
      return (this.buf[i >> 3] >> (i & 7)) & 1;
    };
    Reader.prototype.rb = function (n) {
      var v = 0, p = 1;
      for (var i = 0; i < n; i++) { if (this.bit(this.off + i)) v += p; p *= 2; }
      this.off += n;
      return v;
    };
    Reader.prototype.rbytes = function (n) {
      var a = [];
      for (var i = 0; i < n; i++) a.push(this.rb(8));
      return a;
    };
    Reader.prototype.rstr = function (n) {
      return String.fromCharCode.apply(null, this.rbytes(n));
    };
    Reader.prototype.u16 = function () {
      var a = this.rbytes(2); return a[0] | (a[1] << 8);
    };
    Reader.prototype.align = function () { this.off = (this.off + 7) & ~7; };
    Reader.prototype.seekByte = function (b) { this.off = b * 8; };
    Reader.prototype.mark = function (n, meta) {
      var rec = { off: this.off, bits: n };
      for (var k in meta) if (meta.hasOwnProperty(k)) rec[k] = meta[k];
      rec.raw = this.rb(n);
      this.fields.push(rec);
      return rec;
    };

    // ---------------- decode / encode ----------------
    // JS bitwise operators are signed 32-bit. `x & mask` with a 32-bit mask
    // turns values >= 2^31 (e.g. experience) into negative numbers. Normalise
    // with unsigned modulo instead so setBits() always receives a non-negative
    // integer and never relies on two's-complement coincidence.
    function unsigned(v, bits) {
      var m = Math.pow(2, bits);
      if (!isFinite(v)) v = 0;
      var x = v % m;
      return x < 0 ? x + m : x;
    }
    function decodeVal(rec) {
      var v = rec.raw - (rec.sA || 0);
      if (rec.e === 3) return [v & 0xff, (v >> 8) & 0xff];
      return [v];
    }
    function encodeVal(rec, values) {
      var v;
      if (rec.e === 3) v = (values[0] & 0xff) | ((values[1] & 0xff) << 8);
      else v = values[0];
      return unsigned(v + (rec.sA || 0), rec.bits);
    }

    // ---------------- magic properties ----------------
    // `segments` records the bit layout of each property list so that new
    // stats can be inserted later without re-encoding any existing stat.
    function readMagicProps(r, out, group, segments) {
      var seg = { group: group, startBit: r.off, props: [], endFlagBit: 0, endBit: 0 };
      if (segments) segments.push(seg);
      var pid = r.rb(9);
      while (pid !== 0x1ff) {
        if (pid >= MP.length || !MP[pid]) throw new Error('无效属性 ID ' + pid + ' @bit ' + (r.off - 9));
        var propStartBit = r.off - 9;
        var np = MP[pid].np || 1;
        for (var j = 0; j < np; j++) {
          var idx = pid + j, prop = MP[idx];
          if (!prop) throw new Error('找不到属性定义 ' + idx + ' @bit ' + r.off);
          if (!prop.sB) throw new Error('属性 ' + idx + ':' + prop.s + ' 缺少 Save Bits @bit ' + r.off);
          var p = {
            id: idx, name: prop.s, cn: propCN(prop.s, DATA), group: group,
            dF: prop.dF || 0, e: prop.e || 0, sB: prop.sB, sA: prop.sA || 0, sP: prop.sP || 0,
            params: [], values: []
          };
          if (p.sP) {
            p.params.push(r.mark(p.sP, { kind: 'param', propId: idx, name: p.name, group: group }));
          }
          var vf = r.mark(prop.sB, {
            kind: 'propval', propId: idx, name: p.name, group: group,
            sA: p.sA, e: p.e, sB: prop.sB
          });
          vf.decoded = decodeVal(vf);
          p.values.push(vf);
          out.push(p);
        }
        seg.props.push({ id: pid, startBit: propStartBit, endBit: r.off });
        pid = r.rb(9);
      }
      seg.endFlagBit = r.off - 9;   // start of the 0x1FF terminator
      seg.endBit = r.off;           // first bit after the terminator
    }

    // ---------------- simple bits ----------------
    function readSimpleBits(r, version, item) {
      r.rb(4);
      item.identified = r.rb(1);
      r.rb(6);
      item.socketed = r.rb(1);
      r.rb(1);
      item.new = r.rb(1);
      r.rb(2);
      item.is_ear = r.rb(1);
      item.starter_item = r.rb(1);
      r.rb(3);
      item.simple_item = r.rb(1);
      item.ethereal = r.rb(1);
      r.rb(1);
      item.personalized = r.rb(1);
      r.rb(1);
      item.given_runeword = r.rb(1);
      r.rb(5);
      r.rb(10);                                   // item version (10 bits, version<=0x60)
      item.location_id = r.rb(3);
      item.equipped_id = r.rb(4);
      item.position_x = r.rb(4);
      item.position_y = r.rb(4);
      item.alt_position_id = r.rb(3);
      if (item.is_ear) {
        r.rb(3); r.rb(7);
        for (var e = 0; e < 15; e++) { if (r.rb(7) === 0) break; }
        item.type = '(ear)';
        return;
      }
      item.type = r.rstr(4).replace(/\0/g, '').trim();
      var d = itemTxt(item.type);
      var cats = d && d.c ? d.c : null;
      item.categories = cats || [];
      item.base_name_en = itemName(item.type);
      item.base_name_cn = itemNameCN(item.type);
      item.base_name = item.base_name_cn || item.base_name_en;
      if (cats && cats.indexOf('Any Armor') >= 0) item.type_id = ITEM_TYPE.Armor;
      else if (cats && cats.indexOf('Weapon') >= 0) item.type_id = ITEM_TYPE.Weapon;
      else item.type_id = ITEM_TYPE.Other;
      var bits = item.simple_item ? 1 : 3;
      if (cats && cats.indexOf('Quest') >= 0) { r.rb(MP[356].sB); bits = 1; }
      item.nr_of_items_in_sockets = r.rb(bits);
    }

    var EQUIP_CN = { 1: '头部', 2: '项链', 3: '盔甲', 4: '主手', 5: '副手', 6: '右戒指', 7: '左戒指', 8: '腰带', 9: '靴子', 10: '手套', 11: '副手II', 12: '背部' };
    var LOC_CN = { 0: '背包/仓库', 1: '已装备', 2: '腰带', 3: '地面', 4: '赫拉迪克方块', 5: '仓库', 6: '镶嵌' };
    function locationText(item) {
      if (item.location_id === 1 && item.equipped_id) return EQUIP_CN[item.equipped_id] || ('装备位' + item.equipped_id);
      return LOC_CN[item.location_id] || ('位置' + item.location_id);
    }

    // ---------------- item ----------------
    function readItem(r, version, source, depth) {
      if (version <= 0x60) {
        if (r.rstr(2) !== 'JM') throw new Error("物品头 'JM' 未找到 @bit " + (r.off - 16));
      }
      var item = {
        props: [], socketed_items: [], prop_segments: [],
        source: source || 'char', depth: depth || 0,
        start_byte: (r.off - 16) / 8
      };
      readSimpleBits(r, version, item);
      if (!item.simple_item) {
        item.id = r.rb(32);
        item.level_rec = r.mark(7, { kind: 'item_level' });
        item.level = item.level_rec.raw;
        var q = r.rb(4);
        item.quality = q;
        item.quality_cn = QUALITY_CN[q] || ('品质' + q);
        if (r.rb(1)) r.rb(3);                       // multiple_pictures
        if (r.rb(1)) r.rb(11);                      // class_specific
        if (q === QUALITY.Low) r.rb(3);
        else if (q === QUALITY.Superior) r.rb(3);
        else if (q === QUALITY.Magic) { item.prefix_id = r.rb(11); item.suffix_id = r.rb(11); }
        else if (q === QUALITY.Set) item.set_id = r.rb(12);
        else if (q === QUALITY.Unique) item.unique_id = r.rb(12);
        else if (q === QUALITY.Rare || q === QUALITY.Crafted) {
          item.rare_name_id = r.rb(8); item.rare_name_id2 = r.rb(8);
          for (var k = 0; k < 6; k++) { if (r.rb(1)) r.rb(11); }
        }
        if (item.given_runeword) { item.runeword_id = r.rb(12); r.rb(4); }
        if (item.personalized) { for (var m = 0; m < 16; m++) { if (r.rb(7) === 0) break; } }
        if (item.type === 'tbk' || item.type === 'ibk') r.rb(5);
        r.rb(1);                                    // timestamp
        // defense / durability (corrected to match dschu012)
        if (item.type_id === ITEM_TYPE.Armor) {
          item.defense_rec = r.mark(MP[31].sB, { kind: 'defense', sA: MP[31].sA || 0 });
          item.defense_rec.decoded = [item.defense_rec.raw - (MP[31].sA || 0)];
          item.defense = item.defense_rec.decoded[0];
        }
        if (item.type_id === ITEM_TYPE.Armor || item.type_id === ITEM_TYPE.Weapon) {
          item.maxdur_rec = r.mark(MP[73].sB, { kind: 'maxdur', sA: MP[73].sA || 0 });
          item.maxdur_rec.decoded = [item.maxdur_rec.raw - (MP[73].sA || 0)];
          item.max_durability = item.maxdur_rec.decoded[0];
          if (item.max_durability > 0) {
            item.curdur_rec = r.mark(MP[72].sB, { kind: 'curdur', sA: MP[72].sA || 0 });
            item.curdur_rec.decoded = [item.curdur_rec.raw - (MP[72].sA || 0)];
            item.current_durability = item.curdur_rec.decoded[0];
          }
        }
        if (STACK[item.type]) {
          item.quantity_rec = r.mark(9, { kind: 'quantity' });
          item.quantity_rec.decoded = [item.quantity_rec.raw];
          item.quantity = item.quantity_rec.raw;
        }
        if (item.socketed === 1) {
          item.sockets_rec = r.mark(4, { kind: 'total_sockets' });
          item.sockets_rec.decoded = [item.sockets_rec.raw];
          item.total_nr_of_sockets = item.sockets_rec.raw;
        }
        var plist = 0;
        if (q === QUALITY.Set) plist = r.rb(5);
        readMagicProps(r, item.props, 'magic', item.prop_segments);
        while (plist > 0) {
          if (plist & 1) readMagicProps(r, item.props, 'set', item.prop_segments);
          plist >>= 1;
        }
        if (item.given_runeword === 1) readMagicProps(r, item.props, 'runeword', item.prop_segments);
      }
      item.location_text = locationText(item);
      item.display_name = buildDisplayName(item, DATA);
      r.align();
      item.align_bit = r.off;   // byte-aligned: end of the variable-length bit stream
      if (item.nr_of_items_in_sockets > 0 && item.simple_item === 0) {
        for (var s = 0; s < item.nr_of_items_in_sockets; s++) {
          item.socketed_items.push(readItem(r, version, source, (depth || 0) + 1));
        }
      }
      item.end_byte = r.off / 8;
      item.can_add_props = !item.simple_item && !item.is_ear &&
        item.prop_segments.some(function (g) { return g.group === 'magic'; });
      return item;
    }

    function buildDisplayName(item, DATA) {
      var baseCN = item.base_name_cn || item.base_name_en || item.type;
      var baseEN = item.base_name_en || item.type;
      if (item.simple_item) {
        item.display_name_en = baseEN;
        return baseCN;
      }
      var nCN = null, nEN = null;
      if (item.quality === QUALITY.Unique && item.unique_id != null) {
        nEN = DATA.unq_items[item.unique_id];
        nCN = cn('unq', nEN) || nEN;
      } else if (item.quality === QUALITY.Set && item.set_id != null) {
        nEN = DATA.set_items[item.set_id];
        nCN = cn('set', nEN) || nEN;
      } else if (item.quality === QUALITY.Rare || item.quality === QUALITY.Crafted) {
        var a = DATA.rare_names[item.rare_name_id], b = DATA.rare_names[item.rare_name_id2];
        nEN = [a, b].filter(Boolean).join(' ');
        nCN = [cn('rare', a) || a, cn('rare', b) || b].filter(Boolean).join(' ');
        if (nEN) { nEN = nEN + ' ' + baseEN; nCN = nCN + ' ' + baseCN; }
      } else if (item.quality === QUALITY.Magic) {
        var pre = DATA.magic_prefixes[item.prefix_id], suf = DATA.magic_suffixes[item.suffix_id];
        nEN = [pre, baseEN, suf].filter(Boolean).join(' ');
        nCN = [cn('prefix', pre) || pre, baseCN, cn('suffix', suf) || suf].filter(Boolean).join(' ');
      }
      item.display_name_en = nEN || baseEN;
      return nCN || baseCN;
    }

    function readItems(r, version, source) {
      if (r.rstr(2) !== 'JM') throw new Error("物品列表头 'JM' 未找到 @bit " + (r.off - 16));
      var cnt = r.u16(), items = [];
      for (var i = 0; i < cnt; i++) items.push(readItem(r, version, source));
      return items;
    }

    // ---------------- checksum ----------------
    function checksum(buf) {
      var c = 0;
      for (var i = 0; i < buf.length; i++) {
        var byte = buf[i];
        if (i >= 0x0c && i < 0x10) byte = 0;   // checksum field treated as zero
        if (c & 0x80000000) byte += 1;
        c = (byte + c * 2) >>> 0;
      }
      return c >>> 0;
    }

    // ---------------- full parse ----------------
    function parse(buf) {
      if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
      var r = new Reader(buf), res = { size: buf.length };
      r.seekByte(0);
      res.magic = r.rb(32);
      res.version = r.rb(32);
      res.filesize_field = (buf[8] | (buf[9] << 8) | (buf[10] << 16) | (buf[11] << 24)) >>> 0;
      res.checksum_field = (buf[12] | (buf[13] << 8) | (buf[14] << 16) | (buf[15] << 24)) >>> 0;
      res.checksum_computed = checksum(buf);
      res.checksum_ok = res.checksum_field === res.checksum_computed;
      var name = '';
      for (var i = 0x14; i < 0x24; i++) { if (buf[i] === 0) break; name += String.fromCharCode(buf[i]); }
      res.name = name;
      res.status = buf[0x24];
      res.expansion = !!(buf[0x24] & 0x20);
      res.hardcore = !!(buf[0x24] & 0x04);
      res.class_id = buf[0x28];
      res.class_name = CLASSES[res.class_id] || ('职业' + res.class_id);
      res.level_byte = buf[0x2b];

      r.seekByte(765);
      if (r.rstr(2) !== 'gf') throw new Error("属性段头 'gf' 未找到 @byte 765");
      var attrs = [], pid = r.rb(9);
      while (pid !== 0x1ff) {
        if (pid >= MP.length || !MP[pid]) throw new Error('无效属性 ID ' + pid + ' @bit ' + (r.off - 9));
        var f = MP[pid], cB = f.cB;
        var shift = (pid >= 6 && pid <= 11) ? 8 : 0;
        var rec = r.mark(cB, { kind: 'attr', id: pid, shift: shift });
        rec.decoded = [shift ? (rec.raw >> shift) : rec.raw];
        var lab = ATTR_LABEL[pid] || [f.s, f.s];
        attrs.push({ id: pid, cn: lab[0], en: lab[1], value: rec.decoded[0], cB: cB, anchor: rec });
        pid = r.rb(9);
      }
      r.align();
      res.attributes = attrs;

      if (r.rstr(2) !== 'if') throw new Error("技能段头 'if' 未找到 @bit " + (r.off - 16));
      r.rbytes(30);

      res.items = readItems(r, res.version, 'char');
      res.item_count = res.items.length;

      if (r.rstr(2) !== 'JM') throw new Error("尸体段头 'JM' 未找到 @bit " + (r.off - 16));
      res.corpse_count = r.u16();
      res.corpses = [];
      for (var c = 0; c < res.corpse_count; c++) {
        r.rbytes(12);
        res.corpses.push(readItems(r, res.version, 'corpse'));
      }
      res.merc_items = [];
      if (res.expansion) {
        if (r.rstr(2) !== 'jf') throw new Error("雇佣兵段头 'jf' 未找到 @bit " + (r.off - 16));
        res.merc_id = (buf[0xb3] | (buf[0xb4] << 8) | (buf[0xb5] << 16) | (buf[0xb6] << 24)) >>> 0;
        if (res.merc_id !== 0) res.merc_items = readItems(r, res.version, 'merc');
        if (r.rstr(2) !== 'kf') throw new Error("石魔段头 'kf' 未找到 @bit " + (r.off - 16));
        var hg = r.rb(8);
        if (hg === 1) res.golem_item = readItem(r, res.version, 'golem');
      }
      r.align();
      res.end_byte = r.off / 8;
      res.fields = r.fields;
      // Top-level items of every section, in file order. The gaps between them
      // are section markers / counts / 12-byte corpse headers and are copied
      // verbatim by rebuildAll().
      res.toplevel = [].concat(res.items);
      for (var ti = 0; ti < res.corpses.length; ti++) res.toplevel = res.toplevel.concat(res.corpses[ti]);
      res.toplevel = res.toplevel.concat(res.merc_items);
      if (res.golem_item) res.toplevel.push(res.golem_item);
      res.toplevel.sort(function (a, b) { return a.start_byte - b.start_byte; });
      res.ok = res.end_byte === buf.length;
      return res;
    }

    // ---------------- in-place edit ----------------
    function setBits(buf, bitOff, n, value) {
      var v = value;
      for (var i = 0; i < n; i++) {
        var b = v % 2;
        v = Math.floor(v / 2);
        var idx = bitOff + i, byteI = idx >> 3, bitI = idx & 7;
        if (b) buf[byteI] |= (1 << bitI);
        else buf[byteI] &= ~(1 << bitI) & 0xff;
      }
    }

    function encodeField(anchor, newValue) {
      if (anchor.kind === 'attr') {
        var shift = anchor.shift || 0;
        // HP/mana/stamina are 8.8 fixed point: the low 8 bits hold the fraction.
        // Keep the original fraction so editing the displayed integer touches
        // only the integer bits (byte-minimal, no precision loss).
        var frac = (shift && anchor.raw != null) ? (anchor.raw % Math.pow(2, shift)) : 0;
        return unsigned(Number(newValue) * Math.pow(2, shift) + frac, anchor.bits);
      }
      if (anchor.kind === 'propval') {
        var vals = (newValue instanceof Array) ? newValue : [newValue];
        return encodeVal(anchor, vals);
      }
      // defense / maxdur / curdur / quantity / sockets / item_level / param
      var bias = anchor.sA || 0;
      return unsigned(Number(newValue) + bias, anchor.bits);
    }

    function fixHeader(buf) {
      var eof = buf.length;
      buf[8] = eof & 0xff; buf[9] = (eof >> 8) & 0xff; buf[10] = (eof >> 16) & 0xff; buf[11] = (eof >> 24) & 0xff;
      buf[12] = buf[13] = buf[14] = buf[15] = 0;
      var c = checksum(buf);
      buf[12] = c & 0xff; buf[13] = (c >> 8) & 0xff; buf[14] = (c >> 16) & 0xff; buf[15] = (c >>> 24) & 0xff;
      return c >>> 0;
    }

    /**
     * edits: [{anchor, value}]  levelSync: optional new level byte (0x2b)
     * Returns a NEW Uint8Array; original is untouched.
     */
    function applyEdits(original, edits, levelSync) {
      var buf = new Uint8Array(original);
      for (var i = 0; i < edits.length; i++) {
        var e = edits[i];
        var raw = encodeField(e.anchor, e.value);
        setBits(buf, e.anchor.off, e.anchor.bits, raw);
      }
      if (levelSync != null) buf[0x2b] = levelSync;
      fixHeader(buf);
      return buf;
    }

    // =====================================================================
    // ADD PROPERTY / ADD SKILL  --  structural rewrite
    //
    // An item is a byte-aligned block: a variable-length bit stream (header +
    // property lists + 0x1FF terminators) followed by zero or more byte-aligned
    // socketed items. To append a stat we splice its bits into the *magic*
    // property list (in ascending stat-id order, just like the game writes),
    // re-pad the bit stream to a byte boundary, then re-attach the socketed
    // items verbatim. Every non-target byte of the save is copied unchanged.
    // =====================================================================

    var ADDMAP = {};
    (DATA.add ? DATA.add.addable : []).forEach(function (a) { ADDMAP[a.id] = a; });

    function addableProps() { return DATA.add ? DATA.add.addable : []; }

    function pushBits(arr, value, n) {
      var v = unsigned(value, n);
      for (var i = 0; i < n; i++) { arr.push(v % 2); v = Math.floor(v / 2); }
    }
    function readBits(buf, bitOff, count) {
      var a = new Array(count);
      for (var i = 0; i < count; i++) {
        var k = bitOff + i;
        a[i] = (buf[k >> 3] >> (k & 7)) & 1;
      }
      return a;
    }
    function bitsToBytes(bits) {
      var out = new Uint8Array(bits.length / 8);
      for (var i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= (1 << (i & 7));
      return out;
    }
    function concatBytes(parts) {
      var n = 0, i;
      for (i = 0; i < parts.length; i++) n += parts[i].length;
      var out = new Uint8Array(n), p = 0;
      for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
      return out;
    }

    // Parameter widgets that are more useful than a raw number.
    var PARAM_KIND = {
      83: 'class',    // +N to <class> Skill Levels   (sP=3)
      126: 'raw',     // +N to elemental skills       (sP=3, 0..7)
      151: 'skill',   // aura                        (sP=9, skill id)
      98: 'raw', 155: 'raw', 179: 'raw', 180: 'raw'
    };

    /**
     * Describe the input fields needed to encode a new stat. The field order
     * matches dschu012's magic-property "values" array exactly:
     *   sP param (+ optional tab/class or level/skill sub-fields), then value
     *   (+ optional current/max charges for e=3).
     */
    function describeAddProp(id) {
      var m = ADDMAP[id];
      if (!m) return null;
      var fields = [];
      for (var j = 0; j < m.np; j++) {
        var q = m.members[j];
        var pfx = m.np > 1 ? ('#' + (j + 1) + ' ') : '';
        if (q.sP) {
          var kind = PARAM_KIND[id] || 'raw';
          if (q.e === 2 || q.e === 3) {
            fields.push({ label: pfx + '技能等级', kind: 'num', min: 0, max: 63, def: 1, key: 'sklvl' });
            fields.push({ label: pfx + '技能', kind: 'skill', min: 0, max: 1023, def: 54, key: 'skill' });
          } else if (q.dF === 14) {
            fields.push({ label: pfx + '技能系', kind: 'tab', min: 0, max: 7, def: 0, key: 'tab' });
            fields.push({ label: pfx + '职业', kind: 'class', min: 0, max: 6, def: 0, key: 'class' });
          } else if (q.e === 1) {
            fields.push({ label: pfx + '技能', kind: 'skill', min: 0, max: Math.pow(2, q.sP) - 1, def: 54, key: 'skill' });
          } else if (kind === 'class') {
            fields.push({ label: pfx + '职业', kind: 'class', min: 0, max: Math.pow(2, q.sP) - 1, def: 0, key: 'class' });
          } else if (kind === 'skill') {
            fields.push({ label: pfx + '技能', kind: 'skill', min: 0, max: Math.pow(2, q.sP) - 1, def: 0, key: 'skill' });
          } else {
            fields.push({ label: pfx + '参数（原始值）', kind: 'num', min: 0, max: Math.pow(2, q.sP) - 1, def: 0, key: 'raw' });
          }
        }
        if (q.e === 3) {
          fields.push({ label: pfx + '当前充能', kind: 'num', min: 0, max: 255, def: 5, key: 'cur' });
          fields.push({ label: pfx + '最大充能', kind: 'num', min: 0, max: 255, def: 5, key: 'max' });
        } else {
          fields.push({
            label: pfx + '数值', kind: 'num', min: -(q.sA || 0),
            max: Math.pow(2, q.sB) - 1 - (q.sA || 0), def: 1, key: 'val'
          });
        }
      }
      return {
        id: id, cn: m.cn, en: m.s, np: m.np, cat: m.cat, fields: fields,
        defaults: fields.map(function (f) { return f.def; }),
        bits: fields.length
      };
    }

    /** Encode one new property into a bit array (LSB-first, 9-bit stat id first). */
    function buildPropBits(id, values) {
      var m = ADDMAP[id];
      if (!m) throw new Error('属性 ' + id + ' 不可添加');
      var bits = [], vi = 0;
      pushBits(bits, id, 9);
      for (var j = 0; j < m.np; j++) {
        var q = m.members[j];
        if (q.sP) {
          var param = Number(values[vi++]);
          if (q.dF === 14) {
            param = (param & 0x7) | ((Number(values[vi++]) & 0x1fff) * 8);
          } else if (q.e === 2 || q.e === 3) {
            param = (param & 0x3f) | ((Number(values[vi++]) & 0x3ff) * 64);
          }
          pushBits(bits, param, q.sP);
        }
        var v = Number(values[vi++]) + (q.sA || 0);
        if (q.e === 3) v = (v & 0xff) | ((Number(values[vi++]) & 0xff) * 256);
        pushBits(bits, v, q.sB);
      }
      return bits;
    }

    /** Clamp / validate the UI values for a new property. */
    function normalizeAddValues(id, values) {
      var d = describeAddProp(id);
      if (!d) throw new Error('属性 ' + id + ' 不可添加');
      var out = [];
      for (var i = 0; i < d.fields.length; i++) {
        var f = d.fields[i], v = Number(values && values[i]);
        if (!isFinite(v)) v = f.def;
        v = Math.round(v);
        if (v < f.min) v = f.min;
        if (v > f.max) v = f.max;
        out.push(v);
      }
      return out;
    }

    function magicSegment(item) {
      for (var i = 0; i < item.prop_segments.length; i++) {
        if (item.prop_segments[i].group === 'magic') return item.prop_segments[i];
      }
      return null;
    }

    function insertBitFor(seg, newId) {
      for (var i = 0; i < seg.props.length; i++) {
        if (seg.props[i].id > newId) return seg.props[i].startBit;
      }
      return seg.endFlagBit;
    }

    function insertionsFor(item, adds, buf) {
      if (!adds || !adds.length) return [];
      var seg = magicSegment(item);
      if (!seg) throw new Error('该物品没有可编辑的属性列表（简易物品/金币/耳朵）');
      var list = [];
      for (var i = 0; i < adds.length; i++) {
        list.push({
          bit: insertBitFor(seg, adds[i].id),
          id: adds[i].id, seq: i,
          bits: buildPropBits(adds[i].id, adds[i].values)
        });
      }
      // splice from the back so earlier bit offsets stay valid. Equal offsets
      // are processed high-id / high-seq first so the final list is ascending.
      list.sort(function (a, b) { return (b.bit - a.bit) || (b.id - a.id) || (b.seq - a.seq); });
      return list;
    }

    function rebuildItem(buf, item, addMap) {
      var a0 = item.start_byte * 8, a1 = item.align_bit;
      var bits = readBits(buf, a0, a1 - a0);
      // Everything after the LAST 0x1FF terminator is byte-alignment padding.
      // It must be discarded and recomputed: keeping the old padding AND adding
      // new padding would shift the following item by a whole byte.
      var effective = 0;
      for (var s = 0; s < item.prop_segments.length; s++) {
        effective = Math.max(effective, item.prop_segments[s].endBit - a0);
      }
      if (!effective) effective = bits.length;
      if (effective > bits.length) effective = bits.length;
      var ins = insertionsFor(item, addMap[item.start_byte], buf);
      var inserted = 0;
      for (var i = 0; i < ins.length; i++) {
        var rel = ins[i].bit - a0;
        if (rel < 0 || rel > effective) throw new Error('属性插入位置越界');
        bits = bits.slice(0, rel).concat(ins[i].bits, bits.slice(rel));
        inserted += ins[i].bits.length;
      }
      bits.length = effective + inserted;   // drop old padding
      while (bits.length % 8) bits.push(0); // recompute byte alignment
      var parts = [bitsToBytes(bits)];
      for (var c = 0; c < item.socketed_items.length; c++) {
        parts.push(rebuildItem(buf, item.socketed_items[c], addMap));
      }
      return concatBytes(parts);
    }

    function allItemKeys(items, set) {
      for (var i = 0; i < items.length; i++) {
        set[items[i].start_byte] = 1;
        allItemKeys(items[i].socketed_items, set);
      }
      return set;
    }

    function rebuildAll(buf, res, additions) {
      var map = {}, known = {};
      allItemKeys(res.toplevel, known);
      for (var i = 0; i < additions.length; i++) {
        var a = additions[i];
        if (!known[a.item]) throw new Error('找不到目标物品（字节位置 ' + a.item + '）');
        (map[a.item] = map[a.item] || []).push({
          id: a.id, values: normalizeAddValues(a.id, a.values)
        });
      }
      var parts = [], cur = 0;
      for (var t = 0; t < res.toplevel.length; t++) {
        var top = res.toplevel[t];
        if (top.start_byte < cur) throw new Error('物品字节范围重叠，无法安全重建');
        parts.push(buf.slice(cur, top.start_byte));
        parts.push(rebuildItem(buf, top, map));
        cur = top.end_byte;
      }
      parts.push(buf.slice(cur));
      return concatBytes(parts);
    }

    /**
     * Unified save: ordinary in-place edits first, then structural additions.
     * opts = { edits:[{anchor,value}], additions:[{item,id,values}], levelSync }
     */
    function save(original, opts) {
      opts = opts || {};
      var buf = applyEdits(original, opts.edits || [], opts.levelSync);
      var adds = opts.additions || [];
      if (!adds.length) return buf;
      var res = parse(buf);
      if (!res.ok) throw new Error('存档未能精确对齐 EOF，为安全起见拒绝添加属性');
      var out = rebuildAll(buf, res, adds);
      fixHeader(out);
      return out;
    }

    function fieldRange(anchor) {
      var max = Math.pow(2, anchor.bits) - 1;
      if (anchor.kind === 'attr') {
        var shift = anchor.shift || 0;
        return { min: 0, max: Math.floor(max / Math.pow(2, shift)) };
      }
      if (anchor.kind === 'propval') {
        if (anchor.e === 3) return { min: 0, max: 255 };
        return { min: -(anchor.sA || 0), max: max - (anchor.sA || 0) };
      }
      return { min: -(anchor.sA || 0), max: max - (anchor.sA || 0) };
    }

    function flatten(items, out, parentLabel) {
      out = out || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        it._flat_label = (parentLabel || '') + it.display_name;
        out.push(it);
        if (it.socketed_items && it.socketed_items.length) flatten(it.socketed_items, out, '↳ ');
      }
      return out;
    }

    return {
      parse: parse, applyEdits: applyEdits, save: save, fixHeader: fixHeader, checksum: checksum,
      setBits: setBits, encodeField: encodeField, fieldRange: fieldRange,
      decodeVal: decodeVal, flatten: flatten, propCN: propCN,
      addableProps: addableProps, describeAddProp: describeAddProp,
      normalizeAddValues: normalizeAddValues, buildPropBits: buildPropBits,
      ITEM_TYPE: ITEM_TYPE, QUALITY: QUALITY, QUALITY_CN: QUALITY_CN, ATTR_LABEL: ATTR_LABEL
    };
  }

  return { makeEngine: makeEngine, PROP_CN: PROP_CN, ATTR_LABEL: ATTR_LABEL, QUALITY_CN: QUALITY_CN };
});
