export const rooms = ['客厅', '餐厅', '厨房', '主卧', '书房', '次卧', '主卫', '客卫'];
export const categories = ['电费', '水费', '燃气费', '移动话费', '联通话费', '电信话费'] as const;
export type Category = typeof categories[number];
export const members = { self: '我', partner: '爱人', child: '孩子', parents: '爸妈', stranger: '陌生指纹' };
export type Member = keyof typeof members;
