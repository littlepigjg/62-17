import React, { useEffect, useState } from 'react';
import { Layout, Tabs, Badge, Modal } from 'antd';
import {
  DesktopOutlined,
  CodeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import MachineManagement from './components/MachineManagement';
import TerminalPanel from './components/TerminalPanel';
import ScriptLibrary from './components/ScriptLibrary';
import LogViewer from './components/LogViewer';
import CollaborativePage from './components/CollaborativePage';
import NotificationCenter from './components/NotificationCenter';
import { useAppStore } from './store';
import { wsService } from './services/websocket';
import type { ScriptTemplate } from './types';

const { Header, Content } = Layout;

const App: React.FC = () => {
  const { currentTab, setCurrentTab, handleStreamMessage, activeTasks } = useAppStore();
  const [collaboratingTpl, setCollaboratingTpl] = useState<ScriptTemplate | null>(null);

  useEffect(() => {
    const unsub = wsService.onMessage(handleStreamMessage);
    return () => unsub();
  }, [handleStreamMessage]);

  const runningCount = Array.from(activeTasks.values()).filter(
    t => t.status === 'running' || t.status === 'pending'
  ).length;

  const tabItems = [
    {
      key: 'execute',
      label: (
        <span>
          <DesktopOutlined />
          命令执行
          {runningCount > 0 && <Badge count={runningCount} style={{ marginLeft: 8 }} />}
        </span>
      ),
      children: <TerminalPanel />,
    },
    {
      key: 'machines',
      label: (
        <span>
          <CodeOutlined />
          机器管理
        </span>
      ),
      children: <MachineManagement />,
    },
    {
      key: 'templates',
      label: (
        <span>
          <FileTextOutlined />
          脚本库
        </span>
      ),
      children: (
        <ScriptLibrary
          onCollaborate={(tpl) => setCollaboratingTpl(tpl)}
        />
      ),
    },
    {
      key: 'logs',
      label: (
        <span>
          <HistoryOutlined />
          执行历史
        </span>
      ),
      children: <LogViewer />,
    },
  ];

  return (
    <Layout className="app-layout">
      <Header
        className="app-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
        }}
      >
        <h1 style={{ margin: 0 }}>🚀 远程命令执行与脚本管理平台</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NotificationCenter />
        </div>
      </Header>
      <Content className="app-content">
        <Tabs
          activeKey={currentTab}
          onChange={setCurrentTab}
          items={tabItems}
          size="large"
        />
      </Content>

      <Modal
        open={!!collaboratingTpl}
        onCancel={() => setCollaboratingTpl(null)}
        title={null}
        footer={null}
        width="98vw"
        style={{ top: 20, padding: 0 }}
        bodyStyle={{ padding: 0, height: '90vh' }}
        destroyOnClose
        maskClosable
        zIndex={2000}
      >
        {collaboratingTpl && (
          <CollaborativePage
            docId={collaboratingTpl.id}
            docName={collaboratingTpl.name}
            interpreter={collaboratingTpl.interpreter}
            onBack={() => setCollaboratingTpl(null)}
            initialPermission="owner"
          />
        )}
      </Modal>
    </Layout>
  );
};

export default App;
