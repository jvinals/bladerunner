import { NavLink, useLocation } from 'react-router-dom';
import { Home, Play, Settings, ChevronRight } from 'lucide-react';
import { UserButton, useUser } from '@clerk/react';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/runs', label: 'Runs', icon: Play },
  { to: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation();
  const { user } = useUser();

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <img src="/bladerunner-logo.svg" alt="Bladerunner" className="w-7 h-7" />
          <div>
            <span className="text-[#4B90FF] font-bold text-base tracking-tight">Bladerunner</span>
            <p className="text-[10px] text-gray-400 mt-0">by Edgehealth</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3">
        <p className="text-[10px] font-semibold text-gray-400 tracking-widest uppercase px-2 mb-3">
          Navigation
        </p>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);

            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 w-full text-left text-sm px-3 py-2 rounded-md transition-colors group ${
                    isActive
                      ? 'bg-blue-50 text-[#4B90FF] font-medium'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <item.icon size={16} className={isActive ? 'text-[#4B90FF]' : 'text-gray-400 group-hover:text-gray-600'} />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight size={14} className="text-[#4B90FF]/50" />}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer / User */}
      <div className="px-4 py-4 border-t border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserButton />
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-700 truncate">{user?.fullName || 'User'}</p>
            <p className="text-[10px] text-gray-400 truncate">{user?.primaryEmailAddress?.emailAddress}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
