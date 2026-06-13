import { useState } from 'react';

export default function TenantSearch() {
  const [tenantId, setTenantId] = useState('');
  const [searched, setSearched] = useState('');

  const handleSearch = () => {
    setSearched(tenantId);
  };

  return (
    <div>
      <h2>Tenant Search</h2>
      <div>
        <label htmlFor="searchTenantId">Tenant ID</label>
        <input
          id="searchTenantId"
          type="text"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        />
        <button onClick={handleSearch}>Search</button>
      </div>
      {searched && (
        <div>
          <p>Searching for: {searched}</p>
          <a href={`#impersonate-${searched}`}>
            Open Impersonation Session for {searched}
          </a>
        </div>
      )}
    </div>
  );
}
