import React, { useState } from 'react';
import { Users, Plus, Search, Filter, MoreHorizontal, Shield, UserCheck, UserX, Mail, Calendar, ArrowLeft, Bell } from 'lucide-react';
import { PillButton } from '../ui/pill-button';
import { StatusChip } from '../ui/status-chip';
import { UserAvatar, UserAvatarMenu } from '../ui/user-avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Badge } from '../ui/badge';
import { useUser } from '../UserContext';
import type { AuthScreen } from './types';

interface AdminUserManagementProps {
  onNavigate: (screen: AuthScreen) => void;
}

export function AdminUserManagement({ onNavigate }: AdminUserManagementProps) {
  const { currentUser, users: contextUsers, signOut } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  if (!currentUser) return null;

  // Extended user data for admin table
  const users = contextUsers.map(user => ({
    ...user,
    status: Math.random() > 0.3 ? 'active' : Math.random() > 0.5 ? 'inactive' : 'pending',
    counties: ['Los Angeles', 'Orange', 'Riverside', 'San Bernardino', 'Ventura'].slice(0, Math.floor(Math.random() * 3) + 1),
    lastLogin: ['2 hours ago', '1 day ago', '2 weeks ago', 'Never'][Math.floor(Math.random() * 4)],
    mfaEnabled: Math.random() > 0.3,
    casesCount: Math.floor(Math.random() * 40),
    joinDate: '2023-01-15'
  }));

  const oldUsers = [
    {
      id: '1',
      name: 'Sarah Johnson',
      email: 'sarah.johnson@bailbonds.com',
      role: 'Admin',
      status: 'active',
      counties: ['Los Angeles', 'Orange', 'Riverside'],
      lastLogin: '2 hours ago',
      mfaEnabled: true,
      casesCount: 24,
      joinDate: '2023-01-15',
      avatar: null
    },
    {
      id: '2',
      name: 'Mike Rodriguez',
      email: 'mike.rodriguez@bailbonds.com',
      role: 'Agent',
      status: 'active',
      counties: ['San Bernardino', 'Riverside'],
      lastLogin: '1 day ago',
      mfaEnabled: true,
      casesCount: 18,
      joinDate: '2023-03-22',
      avatar: null
    },
    {
      id: '3',
      name: 'Lisa Chen',
      email: 'lisa.chen@bailbonds.com',
      role: 'Agent',
      status: 'inactive',
      counties: ['Orange'],
      lastLogin: '2 weeks ago',
      mfaEnabled: false,
      casesCount: 12,
      joinDate: '2023-06-10',
      avatar: null
    },
    {
      id: '4',
      name: 'David Thompson',
      email: 'david.thompson@bailbonds.com',
      role: 'Supervisor',
      status: 'pending',
      counties: ['Los Angeles'],
      lastLogin: 'Never',
      mfaEnabled: false,
      casesCount: 0,
      joinDate: '2024-01-08',
      avatar: null
    },
    {
      id: '5',
      name: 'Jennifer Walsh',
      email: 'jennifer.walsh@bailbonds.com',
      role: 'Agent',
      status: 'active',
      counties: ['Ventura', 'Santa Barbara'],
      lastLogin: '3 hours ago',
      mfaEnabled: true,
      casesCount: 31,
      joinDate: '2022-11-03',
      avatar: null
    }
  ];

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'Admin': return 'bg-purple-100 text-purple-800';
      case 'Supervisor': return 'bg-blue-100 text-blue-800';
      case 'Agent': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role.toLowerCase() === roleFilter;
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
    
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Header */}
      <div className="bg-white border-b border-accent">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg">BailBonds Dashboard</h2>
            </div>
            <div className="flex items-center space-x-4">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <UserAvatarMenu
                user={currentUser}
                size="md"
                showStatus
                onProfileClick={() => onNavigate('profile-settings')}
                onSettingsClick={() => console.log('Settings clicked')}
                onSignOutClick={async () => {
                  await signOut();
                  onNavigate('landing');
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => onNavigate('profile-settings')}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Profile
            </button>
            <div>
              <h1 className="text-2xl text-foreground flex items-center">
                <Users className="h-6 w-6 mr-3" />
                User Management
              </h1>
              <p className="text-muted-foreground">
                Manage team members, roles, and permissions across counties
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <PillButton variant="outline" onClick={() => onNavigate('auth-audit')}>
              View Audit Log
            </PillButton>
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <PillButton>
                  <Plus className="h-4 w-4 mr-2" />
                  Invite User
                </PillButton>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Invite New User</DialogTitle>
                  <DialogDescription>
                    Send an invitation to join the BailBonds Dashboard
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email address</Label>
                    <Input id="invite-email" placeholder="agent@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="agent">Agent</SelectItem>
                        <SelectItem value="supervisor">Supervisor</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-counties">Counties (comma-separated)</Label>
                    <Input id="invite-counties" placeholder="Los Angeles, Orange County" />
                  </div>
                  <div className="flex justify-end space-x-2 pt-4">
                    <PillButton variant="outline" onClick={() => setInviteDialogOpen(false)}>
                      Cancel
                    </PillButton>
                    <PillButton onClick={() => setInviteDialogOpen(false)}>
                      Send Invitation
                    </PillButton>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <p className="text-2xl">{users.length}</p>
                </div>
                <Users className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Users</p>
                  <p className="text-2xl">{users.filter(u => u.status === 'active').length}</p>
                </div>
                <UserCheck className="h-8 w-8 text-success/60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending Invites</p>
                  <p className="text-2xl">{users.filter(u => u.status === 'pending').length}</p>
                </div>
                <Mail className="h-8 w-8 text-yellow-500/60" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">MFA Enabled</p>
                  <p className="text-2xl">{users.filter(u => u.mfaEnabled).length}</p>
                </div>
                <Shield className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Search */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-32">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card>
          <CardHeader>
            <CardTitle>Team Members ({filteredUsers.length})</CardTitle>
            <CardDescription>
              Manage user access, roles, and permissions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Counties</TableHead>
                  <TableHead>Cases</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        <UserAvatar user={user} size="sm" />
                        <div>
                          <p className="text-sm">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getRoleColor(user.role)}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.counties.slice(0, 2).map((county) => (
                          <Badge key={county} variant="outline" className="text-xs">
                            {county}
                          </Badge>
                        ))}
                        {user.counties.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{user.counties.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{user.casesCount}</span>
                    </TableCell>
                    <TableCell>
                      <StatusChip 
                        status={user.status === 'active' ? 'success' : 
                               user.status === 'pending' ? 'pending' : 'inactive'}
                      >
                        {user.status}
                      </StatusChip>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{user.lastLogin}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-1">
                        {user.mfaEnabled ? (
                          <Shield className="h-4 w-4 text-success" title="MFA Enabled" />
                        ) : (
                          <Shield className="h-4 w-4 text-muted-foreground" title="MFA Disabled" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <PillButton variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </PillButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Edit User</DropdownMenuItem>
                          <DropdownMenuItem>Change Role</DropdownMenuItem>
                          <DropdownMenuItem>Reset Password</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem>
                            {user.status === 'active' ? 'Deactivate' : 'Activate'}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">
                            Remove User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
