import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { Button } from '../components/ui/Button';
import './NotFoundPage.scss';

export function NotFoundPage() {
  useDocumentMeta({
    path: '/404',
    title: 'Страница не найдена — Renvio',
    description: 'Такой страницы нет. Вернитесь на главную Renvio.',
  });

  return (
    <header className="page-intro">
      <div className="container">
        <h1>Страница не найдена</h1>
        <p>Возможно, ссылка устарела. Вернитесь на главную страницу.</p>
        <div className="not-found__action">
          <Button to="/">На главную</Button>
        </div>
      </div>
    </header>
  );
}
