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
            src={`${import.meta.env.BASE_URL}portal-banner.jpg`}
            alt="介護業務効率化ポータルアプリ リーホ"
          />
          <Header />
          <PortalNotices />
        </section>
        <AppList />
      </main>
      <Footer />
    </>
  );
}
