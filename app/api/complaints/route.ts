import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user || user.role !== 'citizen') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      title,
      description,
      categoryId,
      latitude,
      longitude,
      address,
      media = [],
    } = body

    // Validation
    if (!title || !description || !categoryId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const complaintId = uuidv4()
    const complaintNumber = `NCIP-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`

    // Insert complaint
    const result = await query(
      `INSERT INTO complaints (
        id, complaint_id, citizen_id, category_id, title, description,
        status, priority, location_lat, location_lng, location_address,
        ai_priority_score, ai_confidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, complaint_id, status, created_at`,
      [
        complaintId,
        complaintNumber,
        user.userId,
        categoryId,
        title,
        description,
        'submitted',
        'medium',
        latitude || null,
        longitude || null,
        address || null,
        0.7, // AI scores will be updated after ML inference
        0.7,
      ]
    )

    const complaint = result.rows[0]

    // Insert media files if provided
    if (media && Array.isArray(media)) {
      for (const file of media) {
        await query(
          `INSERT INTO complaint_media (complaint_id, file_url, file_type, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [complaintId, file.url, file.type, file.mimeType, user.userId]
        )
      }
    }

    return NextResponse.json(
      {
        complaint: {
          id: complaint.id,
          complaintId: complaint.complaint_id,
          status: complaint.status,
          createdAt: complaint.created_at,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Create complaint error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '10', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    let baseQuery = 'SELECT * FROM complaints'
    let params: any[] = []

    // Citizens can only see their own complaints
    if (user.role === 'citizen') {
      baseQuery += ' WHERE citizen_id = $1'
      params.push(user.userId)
    }

    const result = await query(
      baseQuery + ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
      [...params, limit, offset]
    )

    return NextResponse.json({
      complaints: result.rows,
    })
  } catch (error) {
    console.error('Get complaints error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
