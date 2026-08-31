import { useState } from 'react';
import { AccessGate } from './components/AccessGate';
import { Header } from './components/Header';
import { AppList } from './components/AppList';
import { Footer } from './components/Footer';

export default function App() {
  const [hasAccess, setHasAccess] = useState(false);

  if (!hasAccess) {
    return <AccessGate onAccess={() => setHasAccess(true)} />;
  }

  return (
    <>
      <Header />
      <main>
        <AppList />
      </main>
      <Footer />
    </>
  );
}
