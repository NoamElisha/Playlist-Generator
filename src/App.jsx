import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import Header from './Header'
import Body from './Body'


function App() {
  const [count, setCount] = useState(0)

  return (
     <>
      <Header />
      <Body />

    </>
  )
}

export default App
