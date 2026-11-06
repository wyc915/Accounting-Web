import { db, schema } from './db/index.js';

type Seed = { name: string; icon: string; color: string; children?: [string, string][] };

const EXPENSE: Seed[] = [
  { name: '餐飲', icon: 'utensils', color: '#f97316', children: [['早餐', 'croissant'], ['午餐', 'soup'], ['晚餐', 'utensils'], ['飲料', 'cup-soda'], ['點心', 'cookie']] },
  { name: '交通', icon: 'bus', color: '#3b82f6', children: [['大眾運輸', 'train-front'], ['計程車', 'car-taxi-front'], ['加油', 'fuel'], ['停車', 'square-parking']] },
  { name: '購物', icon: 'shopping-bag', color: '#ec4899', children: [['服飾', 'shirt'], ['3C', 'smartphone'], ['日用品', 'spray-can']] },
  { name: '娛樂', icon: 'gamepad-2', color: '#8b5cf6', children: [['電影', 'clapperboard'], ['旅遊', 'plane'], ['訂閱', 'tv']] },
  { name: '居家', icon: 'house', color: '#14b8a6', children: [['房租', 'key-round'], ['水電瓦斯', 'zap'], ['網路電話', 'wifi']] },
  { name: '醫療', icon: 'heart-pulse', color: '#ef4444' },
  { name: '教育', icon: 'graduation-cap', color: '#6366f1' },
  { name: '人情', icon: 'gift', color: '#f43f5e' },
  { name: '其他', icon: 'ellipsis', color: '#64748b' },
];

const INCOME: Seed[] = [
  { name: '薪資', icon: 'briefcase', color: '#10b981' },
  { name: '獎金', icon: 'trophy', color: '#f59e0b' },
  { name: '投資', icon: 'trending-up', color: '#0ea5e9' },
  { name: '兼職', icon: 'laptop', color: '#22c55e' },
  { name: '其他', icon: 'piggy-bank', color: '#64748b' },
];

export function seedUser(userId: number) {
  db.transaction((tx) => {
    const insertTree = (list: Seed[], type: 'expense' | 'income') => {
      list.forEach((c, i) => {
        const [row] = tx
          .insert(schema.categories)
          .values({ userId, type, name: c.name, icon: c.icon, color: c.color, sort: i })
          .returning({ id: schema.categories.id })
          .all();
        c.children?.forEach(([name, icon], j) => {
          tx.insert(schema.categories)
            .values({ userId, type, name, icon, color: c.color, parentId: row.id, sort: j })
            .run();
        });
      });
    };
    insertTree(EXPENSE, 'expense');
    insertTree(INCOME, 'income');

    tx.insert(schema.accounts)
      .values([
        { userId, name: '現金', type: 'cash', icon: 'wallet', color: '#34d399', sort: 0 },
        { userId, name: '銀行帳戶', type: 'bank', icon: 'landmark', color: '#38bdf8', sort: 1 },
        { userId, name: '信用卡', type: 'credit', icon: 'credit-card', color: '#a78bfa', sort: 2 },
      ])
      .run();
  });
}
