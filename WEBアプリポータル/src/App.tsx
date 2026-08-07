import { Header } from './components/Header';
import { AppList } from './components/AppList';
import { Footer } from './components/Footer';

export default function App() {
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
