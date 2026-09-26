import { CompanySchema, type Company, type CompanyRepository } from '@netruimte/shared';
import type { Db } from './db.js';

interface Row {
  id: string;
  name: string;
  website: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  sector: string | null;
  source_urls: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: Row): Company {
  return CompanySchema.parse({
    id: row.id,
    name: row.name,
    website: row.website,
    address: row.address,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    sector: row.sector,
    sourceUrls: JSON.parse(row.source_urls) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const UPSERT_SQL = `
  INSERT INTO companies (id, name, website, address, city, latitude, longitude, sector, source_urls, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,
    website=excluded.website,
    address=excluded.address,
    city=excluded.city,
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    sector=excluded.sector,
    source_urls=excluded.source_urls,
    updated_at=excluded.updated_at
`;

export function createCompanyRepository(db: Db): CompanyRepository {
  return {
    async upsert(company) {
      const c = CompanySchema.parse(company);
      await db.execute(UPSERT_SQL, [
        c.id,
        c.name,
        c.website,
        c.address,
        c.city,
        c.latitude,
        c.longitude,
        c.sector,
        JSON.stringify(c.sourceUrls),
        c.createdAt,
        c.updatedAt,
      ]);
      return c;
    },
    async findById(id) {
      const row = await db.get<Row>(`SELECT * FROM companies WHERE id = ?`, [id]);
      return row ? toDomain(row) : null;
    },
    async findByName(name) {
      const row = await db.get<Row>(`SELECT * FROM companies WHERE name = ?`, [name]);
      return row ? toDomain(row) : null;
    },
    async list() {
      const rows = await db.all<Row>(`SELECT * FROM companies ORDER BY created_at DESC`);
      return rows.map(toDomain);
    },
  };
}
