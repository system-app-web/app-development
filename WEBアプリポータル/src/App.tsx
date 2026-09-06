import { Header } from './components/Header';
import { AppList } from './components/AppList';
import { Footer } from './components/Footer';
import { PortalNotices } from './components/PortalNotices';

export default function App() {
  return (
    <>
      <main>
        <section className="portal-visual" aria-label="リーホ ポータルアプリ">
          <img
            className="portal-visual-image"
            src={`${import.meta.env.BASE_URL}portal-background.png`}
            alt=""
          />
          <Header />
        </section>
        <PortalNotices />
        <AppList />
      </main>
      <Footer />
    </>
  );
}
