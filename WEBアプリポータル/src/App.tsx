import { Header } from './components/Header';
import { AppList } from './components/AppList';
import { Footer } from './components/Footer';
import { PortalNotices } from './components/PortalNotices';

export default function App() {
  return (
    <>
      <Header />
      <main>
        <PortalNotices />
        <AppList />
      </main>
      <Footer />
    </>
  );
}
