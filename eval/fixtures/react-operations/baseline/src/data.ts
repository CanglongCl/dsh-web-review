export interface Order {
  id: string
  customer: string
  amount: string
  status: '待处理' | '已发货' | '已取消'
}

export const orders: Order[] = [
  { id: 'ORD-1048', customer: '星河科技', amount: '¥12,800', status: '待处理' },
  { id: 'ORD-1047', customer: '青山商贸', amount: '¥8,420', status: '已发货' },
  { id: 'ORD-1046', customer: '远景设计', amount: '¥3,260', status: '已取消' },
]
