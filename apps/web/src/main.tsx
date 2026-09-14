import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { ToastProvider } from './components/ui/Toast';
import AdminAttendance from './pages/AdminAttendance';
import AdminDashboard from './pages/AdminDashboard';
import AdminFormEditor from './pages/AdminFormEditor';
import AdminFormsList from './pages/AdminFormsList';
import AdminLayout from './pages/AdminLayout';
import AdminLogin from './pages/AdminLogin';
import AdminSubmissions from './pages/AdminSubmissions';
import Confirmation from './pages/Confirmation';
import Home from './pages/Home';
import PaymentMethods from './pages/PaymentMethods';
import PublicForm from './pages/PublicForm';
import Scanner from './pages/Scanner';
import ScannerLogin from './pages/ScannerLogin';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/platnosci', element: <PaymentMethods /> },
  { path: '/f/:slug', element: <PublicForm /> },
  { path: '/potwierdzenie/:submissionId', element: <Confirmation /> },
  { path: '/admin/login', element: <AdminLogin /> },
  { path: '/skaner', element: <Scanner /> },
  { path: '/skaner/login', element: <ScannerLogin /> },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminFormsList /> },
      { path: 'statystyki', element: <AdminDashboard /> },
      { path: 'formularze/nowy', element: <AdminFormEditor /> },
      { path: 'formularze/:id', element: <AdminFormEditor /> },
      { path: 'formularze/:id/zgloszenia', element: <AdminSubmissions /> },
      { path: 'formularze/:id/obecnosc', element: <AdminAttendance /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
);
