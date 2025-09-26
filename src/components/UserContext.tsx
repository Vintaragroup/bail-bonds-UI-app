import React, { createContext, useContext, useState } from 'react';
import { UserProfile } from './ui/user-avatar';

interface UserContextType {
  currentUser: UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  users: UserProfile[];
  updateUserProfile: (userId: string, updates: Partial<UserProfile>) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

// Sample users with different avatar configurations
const sampleUsers: UserProfile[] = [
  {
    id: '1',
    name: 'Sarah Johnson',
    email: 'sarah.johnson@bailbonds.com',
    role: 'Admin',
    initials: 'SJ',
    avatarIcon: 'crown',
    avatarColor: 'purple'
  },
  {
    id: '2', 
    name: 'Mike Rodriguez',
    email: 'mike.rodriguez@bailbonds.com',
    role: 'Agent',
    initials: 'MR',
    avatarIcon: 'shield',
    avatarColor: 'blue'
  },
  {
    id: '3',
    name: 'Lisa Chen', 
    email: 'lisa.chen@bailbonds.com',
    role: 'Agent',
    initials: 'LC',
    avatarIcon: 'star',
    avatarColor: 'emerald'
  },
  {
    id: '4',
    name: 'David Thompson',
    email: 'david.thompson@bailbonds.com', 
    role: 'Supervisor',
    initials: 'DT',
    avatarIcon: 'briefcase',
    avatarColor: 'indigo'
  },
  {
    id: '5',
    name: 'Jennifer Walsh',
    email: 'jennifer.walsh@bailbonds.com',
    role: 'Agent',
    initials: 'JW',
    avatarIcon: 'userCheck',
    avatarColor: 'teal'
  }
];

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(sampleUsers[0]);
  const [users, setUsers] = useState<UserProfile[]>(sampleUsers);

  const updateUserProfile = (userId: string, updates: Partial<UserProfile>) => {
    setUsers(prev => prev.map(user => 
      user.id === userId ? { ...user, ...updates } : user
    ));
    
    if (currentUser?.id === userId) {
      setCurrentUser(prev => prev ? { ...prev, ...updates } : null);
    }
  };

  return (
    <UserContext.Provider value={{
      currentUser,
      setCurrentUser,
      users,
      updateUserProfile
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}