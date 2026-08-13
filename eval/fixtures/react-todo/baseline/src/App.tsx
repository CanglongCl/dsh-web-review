import { useState } from 'react'

function NavItem({ label }: { label: string }) {
  return <li className="nav-item">{label}</li>
}

export function App() {
  const [todos, setTodos] = useState(['写评测用例', '修预览代理', '更新文档'])
  return (
    <div className="layout">
      <nav className="sidebar">
        <ul className="nav-list">
          <NavItem label="收件箱" />
          <NavItem label="已加星标" />
          <NavItem label="草稿" />
        </ul>
      </nav>
      <main className="content">
        <h1 className="title">待办清单</h1>
        <ul className="todos">
          {todos.map((todo) => <li key={todo} className="todo-item">{todo}</li>)}
        </ul>
        <button className="add-button" onClick={() => setTodos([...todos, '新任务'])}>添加任务</button>
      </main>
    </div>
  )
}
