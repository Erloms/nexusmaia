
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  checkPaymentStatus: () => boolean;
  signOut: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  hasPermission: (feature: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 获取初始会话
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // 监听认证状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkPaymentStatus = () => {
    if (!user) return false;
    
    // 检查管理员权限 - 修正管理员邮箱检查
    if (user.email === 'master@admin.com' || user.email === 'morphy.realm@gmail.com') {
      return true;
    }
    
    // 检查VIP用户
    const vipUsers = JSON.parse(localStorage.getItem('vipUsers') || '[]');
    if (vipUsers.includes(user.id)) {
      return true;
    }
    
    return false;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
    }
  };

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw error;
    }
  };

  const register = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) {
      throw error;
    }
  };

  const hasPermission = (feature: string) => {
    if (!user) return false;
    
    // 管理员权限
    if (user.email === 'master@admin.com' || user.email === 'morphy.realm@gmail.com') {
      return true;
    }
    
    // VIP用户权限
    const vipUsers = JSON.parse(localStorage.getItem('vipUsers') || '[]');
    if (vipUsers.includes(user.id)) {
      return true;
    }
    
    return false;
  };

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    checkPaymentStatus,
    signOut,
    login,
    register,
    hasPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
