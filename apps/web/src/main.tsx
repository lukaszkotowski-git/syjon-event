import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import AdminFormEditor from './pages/AdminFormEditor';
import AdminFormsList from './pages/AdminFormsList';
import AdminLayout from './pages/AdminLayout';
import AdminLogin from './pages/AdminLogin';
import AdminSubmissions from './pages/AdminSubmissions';
import Confirmation from './pages/Confirmation';
import Home from './pages/Home';
import PublicForm from './pages/PublicForm';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/f/:slug', element: <PublicForm /> },
  { path: '/potwierdzenie/:submissionId', element: <Confirmation /> },
  { path: '/admin/login', element: <AdminLogin /> },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminFormsList /> },
      { path: 'formularze/nowy', element: <AdminFormEditor /> },
      { path: 'formularze/:id', element: <AdminFormEditor /> },
      { path: 'formularze/:id/zgloszenia', element: <AdminSubmissions /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
