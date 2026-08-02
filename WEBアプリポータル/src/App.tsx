import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { AppList } from './components/AppList';
import { Footer } from './components/Footer';

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <AppList />
      </main>
      <Footer />
    </>
  );
}
