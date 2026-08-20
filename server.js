const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});


// ======================================================
// ADMIN JWT MIDDLEWARE
// ======================================================

function verifyAdminToken(req, res, next) {
  try {

    const authHeader =
      req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith('Bearer ')
    ) {

      return res.status(401).json({
        success: false,
        message:
          'Müəllim girişi tələb olunur'
      });

    }

    const token =
      authHeader.split(' ')[1];

    if (!process.env.JWT_SECRET) {

      console.error(
        '❌ JWT_SECRET .env faylında yoxdur.'
      );

      return res.status(500).json({
        success: false,
        message:
          'Server təhlükəsizlik konfiqurasiyası tamamlanmayıb'
      });

    }

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    if (
      !decoded ||
      decoded.role !== 'admin'
    ) {

      return res.status(403).json({
        success: false,
        message:
          'Bu əməliyyat üçün icazəniz yoxdur'
      });

    }

    req.admin =
      decoded;

    next();

  } catch (error) {

    if (
      error.name === 'TokenExpiredError'
    ) {

      return res.status(401).json({
        success: false,
        message:
          'Müəllim sessiyasının vaxtı bitib. Yenidən daxil olun.'
      });

    }

    return res.status(401).json({
      success: false,
      message:
        'Token etibarsızdır. Yenidən daxil olun.'
    });

  }
}


// ======================================================
// DATABASE CƏDVƏLLƏRİ
// ======================================================

async function initDatabase() {
  try {

    // Şagirdlər
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_name VARCHAR(150) NOT NULL,
        student_code VARCHAR(50) UNIQUE NOT NULL,
        parent_name VARCHAR(150),
        parent_code VARCHAR(50) UNIQUE NOT NULL,
        student_class VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Nəticələr
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,

        student_id INTEGER NOT NULL
          REFERENCES students(id)
          ON DELETE CASCADE,

        type VARCHAR(100),
        title VARCHAR(200),
        score NUMERIC NOT NULL,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Davamiyyət
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,

        student_id INTEGER NOT NULL
          REFERENCES students(id)
          ON DELETE CASCADE,

        lesson_date DATE NOT NULL,

        status VARCHAR(20) NOT NULL
          CHECK (status IN ('present', 'absent')),

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(student_id, lesson_date)
      );
    `);

    // Müəllim qeydləri
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_notes (
        id SERIAL PRIMARY KEY,

        student_id INTEGER NOT NULL
          REFERENCES students(id)
          ON DELETE CASCADE,

        note TEXT NOT NULL,

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log(
      '✅ Database cədvəlləri hazırdır!'
    );

  } catch (error) {

    console.error(
      '❌ Cədvəl yaratma xətası:',
      error.message
    );

  }
}


// ======================================================
// POSTGRESQL BAĞLANTISI TEST
// ======================================================

pool.query('SELECT NOW()')
  .then(() => {

    console.log(
      '✅ PostgreSQL bağlantısı uğurludur!'
    );

  })
  .catch((err) => {

    console.error(
      '❌ PostgreSQL bağlantı xətası:',
      err.message
    );

  });


// ======================================================
// 1. BÜTÜN ŞAGİRDLƏRİ AL
// ======================================================

app.get(
  '/api/students',
  verifyAdminToken,
  async (req, res) => {

    try {

      const studentsResult =
        await pool.query(`
          SELECT
            id,
            student_name AS "studentName",
            student_code AS "studentCode",
            parent_name AS "parentName",
            parent_code AS "parentCode",
            student_class AS "studentClass",
            created_at AS "createdAt"
          FROM students
          ORDER BY id DESC
        `);

      const students = [];

      for (
        const student of
        studentsResult.rows
      ) {

        const scoresResult =
          await pool.query(`
            SELECT
              id,
              type,
              title,
              score,
              created_at AS "createdAt"
            FROM scores
            WHERE student_id = $1
            ORDER BY created_at DESC
          `, [
            student.id
          ]);

        students.push({
          ...student,
          scores:
            scoresResult.rows
        });

      }

      res.json(
        students
      );

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        message:
          'Şagirdlər alınarkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 2. YENİ ŞAGİRD YARAT
// ======================================================

app.post(
  '/api/students',
  verifyAdminToken,
  async (req, res) => {

    try {

      const {
        studentName,
        studentCode,
        parentName,
        parentCode,
        studentClass
      } = req.body;

      if (
        !studentName ||
        !studentCode ||
        !parentCode
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Şagird adı, şagird kodu və valideyn kodu vacibdir'
        });

      }

      const result =
        await pool.query(`
          INSERT INTO students (
            student_name,
            student_code,
            parent_name,
            parent_code,
            student_class
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )

          RETURNING
            id,
            student_name AS "studentName",
            student_code AS "studentCode",
            parent_name AS "parentName",
            parent_code AS "parentCode",
            student_class AS "studentClass"
        `, [
          studentName.trim(),
          studentCode.trim(),
          parentName
            ? parentName.trim()
            : null,
          parentCode.trim(),
          studentClass || null
        ]);

      const newStudent = {
        ...result.rows[0],
        scores: []
      };

      res.status(201).json({
        success: true,
        message:
          'Uğurla yaradıldı!',
        student:
          newStudent
      });

    } catch (error) {

      console.error(
        error
      );

      if (
        error.code ===
        '23505'
      ) {

        return res.status(409).json({
          success: false,
          message:
            'Bu şagird və ya valideyn kodu artıq istifadə olunur'
        });

      }

      res.status(500).json({
        success: false,
        message:
          'Şagird yaradılarkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 3. ŞAGİRD MƏLUMATLARINI YENİLƏ
// ======================================================

app.put(
  '/api/students/:id',
  verifyAdminToken,
  async (req, res) => {

    try {

      const { id } =
        req.params;

      const {
        studentName,
        studentCode,
        parentName,
        parentCode,
        studentClass
      } = req.body;


      if (
        !studentName ||
        !studentCode ||
        !parentCode
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Şagird adı, şagird kodu və valideyn kodu vacibdir'
        });

      }


      const result =
        await pool.query(`
          UPDATE students

          SET
            student_name = $1,
            student_code = $2,
            parent_name = $3,
            parent_code = $4,
            student_class = $5

          WHERE id = $6

          RETURNING
            id,
            student_name AS "studentName",
            student_code AS "studentCode",
            parent_name AS "parentName",
            parent_code AS "parentCode",
            student_class AS "studentClass",
            created_at AS "createdAt"
        `, [
          studentName.trim(),
          studentCode.trim(),
          parentName
            ? parentName.trim()
            : null,
          parentCode.trim(),
          studentClass || null,
          id
        ]);


      if (
        result.rows.length ===
        0
      ) {

        return res.status(404).json({
          success: false,
          message:
            'Şagird tapılmadı'
        });

      }


      res.json({
        success: true,
        message:
          'Şagird məlumatları uğurla yeniləndi',
        student:
          result.rows[0]
      });


    } catch (error) {

      console.error(
        'Şagird yeniləmə xətası:',
        error
      );


      if (
        error.code ===
        '23505'
      ) {

        return res.status(409).json({
          success: false,
          message:
            'Bu şagird və ya valideyn kodu başqa hesabda istifadə olunur'
        });

      }


      res.status(500).json({
        success: false,
        message:
          'Şagird məlumatları yenilənərkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 4. ŞAGİRDİ SİL
// ======================================================

app.delete(
  '/api/students/:id',
  verifyAdminToken,
  async (req, res) => {

    try {

      const { id } =
        req.params;

      const result =
        await pool.query(
          `
            DELETE FROM students
            WHERE id = $1
            RETURNING id
          `,
          [id]
        );

      if (
        result.rows.length ===
        0
      ) {

        return res.status(404).json({
          success: false,
          message:
            'Şagird tapılmadı'
        });

      }

      res.json({
        success: true,
        message:
          'Şagird uğurla silindi'
      });

    } catch (error) {

      console.error(
        'Şagird silmə xətası:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          'Şagird silinərkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 5. SINAQ BALI ƏLAVƏ ET
// ======================================================

app.post(
  '/api/students/score',
  verifyAdminToken,
  async (req, res) => {

    try {

      const {
        studentId,
        type,
        title,
        score
      } = req.body;

      if (
        !studentId ||
        score === undefined
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Şagird ID və bal vacibdir'
        });

      }

      const numericScore =
        Number(score);

      if (
        Number.isNaN(
          numericScore
        ) ||
        numericScore < 0 ||
        numericScore > 100
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Bal 0 ilə 100 arasında olmalıdır'
        });

      }

      const studentCheck =
        await pool.query(
          `
            SELECT id
            FROM students
            WHERE id = $1
          `,
          [studentId]
        );

      if (
        studentCheck.rows.length ===
        0
      ) {

        return res.status(404).json({
          success: false,
          message:
            'Şagird tapılmadı'
        });

      }

      const scoreResult =
        await pool.query(`
          INSERT INTO scores (
            student_id,
            type,
            title,
            score
          )

          VALUES (
            $1,
            $2,
            $3,
            $4
          )

          RETURNING
            id,
            type,
            title,
            score,
            created_at AS "createdAt"
        `, [
          studentId,
          type || null,
          title || null,
          numericScore
        ]);

      res.json({
        success: true,
        message:
          'Sınaq balı əlavə edildi!',
        score:
          scoreResult.rows[0]
      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        success: false,
        message:
          'Bal əlavə edilərkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 6. DAVAMİYYƏT ƏLAVƏ ET / YENİLƏ
// ======================================================

app.post(
  '/api/attendance',
  verifyAdminToken,
  async (req, res) => {

    try {

      const {
        studentId,
        lessonDate,
        status
      } = req.body;

      if (
        !studentId ||
        !lessonDate ||
        !status
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Şagird, tarix və davamiyyət statusu vacibdir'
        });

      }

      if (
        ![
          'present',
          'absent'
        ].includes(status)
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Davamiyyət statusu düzgün deyil'
        });

      }

      const studentCheck =
        await pool.query(
          `
            SELECT id
            FROM students
            WHERE id = $1
          `,
          [studentId]
        );

      if (
        studentCheck.rows.length ===
        0
      ) {

        return res.status(404).json({
          success: false,
          message:
            'Şagird tapılmadı'
        });

      }

      const result =
        await pool.query(`
          INSERT INTO attendance (
            student_id,
            lesson_date,
            status
          )

          VALUES (
            $1,
            $2,
            $3
          )

          ON CONFLICT (
            student_id,
            lesson_date
          )

          DO UPDATE SET
            status =
              EXCLUDED.status

          RETURNING
            id,
            student_id AS "studentId",
            lesson_date AS "lessonDate",
            status,
            created_at AS "createdAt"
        `, [
          studentId,
          lessonDate,
          status
        ]);

      res.json({
        success: true,
        message:
          'Davamiyyət uğurla qeyd edildi!',
        attendance:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'Davamiyyət əlavə etmə xətası:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          'Davamiyyət qeyd edilərkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 7. ŞAGİRDİN DAVAMİYYƏT TARİXÇƏSİ
// ======================================================

app.get(
  '/api/students/:id/attendance',
  verifyAdminToken,
  async (req, res) => {

    try {

      const { id } =
        req.params;

      const result =
        await pool.query(`
          SELECT
            id,
            lesson_date AS "lessonDate",
            status,
            created_at AS "createdAt"
          FROM attendance
          WHERE student_id = $1
          ORDER BY lesson_date DESC
        `, [id]);

      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        'Davamiyyət oxuma xətası:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          'Davamiyyət məlumatları alınarkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 8. MÜƏLLİM QEYDİ ƏLAVƏ ET
// ======================================================

app.post(
  '/api/teacher-notes',
  verifyAdminToken,
  async (req, res) => {

    try {

      const {
        studentId,
        note
      } = req.body;

      if (
        !studentId ||
        !note ||
        !note.trim()
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Şagird və qeyd mətni vacibdir'
        });

      }

      const studentCheck =
        await pool.query(
          `
            SELECT id
            FROM students
            WHERE id = $1
          `,
          [studentId]
        );

      if (
        studentCheck.rows.length ===
        0
      ) {

        return res.status(404).json({
          success: false,
          message:
            'Şagird tapılmadı'
        });

      }

      const result =
        await pool.query(`
          INSERT INTO teacher_notes (
            student_id,
            note
          )

          VALUES (
            $1,
            $2
          )

          RETURNING
            id,
            student_id AS "studentId",
            note,
            created_at AS "createdAt"
        `, [
          studentId,
          note.trim()
        ]);

      res.status(201).json({
        success: true,
        message:
          'Müəllim qeydi əlavə edildi',
        teacherNote:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        'Müəllim qeydi əlavə etmə xətası:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          'Müəllim qeydi əlavə edilərkən xəta baş verdi'
      });

    }

  }
);


// ======================================================
// 9. ŞAGİRDİN MÜƏLLİM QEYDLƏRİ
// ======================================================

app.get(
  '/api/students/:id/teacher-notes',
  verifyAdminToken,
  async (req, res) => {

    try {

      const { id } =
        req.params;

      const result =
        await pool.query(`
          SELECT
            id,
            note,
            created_at AS "createdAt"
          FROM teacher_notes
          WHERE student_id = $1
          ORDER BY created_at DESC
        `, [id]);

      res.json(
        result.rows
      );

    } catch (error) {

      console.error(
        'Müəllim qeydləri oxuma xətası:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          'Müəllim qeydləri alınarkən xəta baş verdi'
      });

    }

  }
);  
// ======================================================
// 10. MÜƏLLİM / ADMIN GİRİŞİ
// ======================================================

app.post('/api/login/admin', async (req, res) => {
  try {

    const {
      code,
      password
    } = req.body;

    if (
      !code ||
      !password
    ) {

      return res.status(400).json({
        success: false,
        message:
          'Müəllim kodu və şifrə vacibdir'
      });

    }

    if (
      !process.env.ADMIN_CODE ||
      !process.env.ADMIN_PASSWORD ||
      !process.env.JWT_SECRET
    ) {

      console.error(
        '❌ ADMIN_CODE, ADMIN_PASSWORD və ya JWT_SECRET .env faylında yoxdur.'
      );

      return res.status(500).json({
        success: false,
        message:
          'Müəllim girişi serverdə tam konfiqurasiya edilməyib'
      });

    }

    const codeIsCorrect =
      code
        .trim()
        .toLowerCase() ===
      process.env.ADMIN_CODE
        .trim()
        .toLowerCase();

    const passwordIsCorrect =
      password ===
      process.env.ADMIN_PASSWORD;

    if (
      !codeIsCorrect ||
      !passwordIsCorrect
    ) {

      return res.status(401).json({
        success: false,
        message:
          'Müəllim kodu və ya şifrə yanlışdır'
      });

    }

    const token =
      jwt.sign(
        {
          role: 'admin',
          code:
            process.env.ADMIN_CODE
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '8h'
        }
      );

    res.json({
      success: true,
      message:
        'Müəllim girişi uğurludur',
      token
    });

  } catch (error) {

    console.error(
      '❌ Müəllim giriş xətası:',
      error
    );

    res.status(500).json({
      success: false,
      message:
        'Server xətası'
    });

  }
});


// ======================================================
// 11. ŞAGİRD GİRİŞİ
// ======================================================

app.post('/api/login/student', async (req, res) => {
  try {

    const { code } =
      req.body;

    if (!code) {

      return res.status(400).json({
        success: false,
        message:
          'Kod boş ola bilməz!'
      });

    }

    const studentResult =
      await pool.query(`
        SELECT
          id,
          student_name AS "studentName",
          student_code AS "studentCode",
          parent_name AS "parentName",
          student_class AS "studentClass"
        FROM students
        WHERE LOWER(student_code) = LOWER($1)
        LIMIT 1
      `, [
        code.trim()
      ]);

    if (
      studentResult.rows.length === 0
    ) {

      return res.status(404).json({
        success: false,
        message:
          'Şagird kodu tapılmadı!'
      });

    }

    const student =
      studentResult.rows[0];


    const scoresResult =
      await pool.query(`
        SELECT
          id,
          type,
          title,
          score,
          created_at AS "createdAt"
        FROM scores
        WHERE student_id = $1
        ORDER BY created_at DESC
      `, [
        student.id
      ]);


    const attendanceResult =
      await pool.query(`
        SELECT
          id,
          lesson_date AS "lessonDate",
          status
        FROM attendance
        WHERE student_id = $1
        ORDER BY lesson_date DESC
      `, [
        student.id
      ]);


    res.json({
      success: true,

      student: {
        ...student,

        scores:
          scoresResult.rows,

        attendance:
          attendanceResult.rows
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message:
        'Server xətası'
    });

  }
});


// ======================================================
// 12. VALİDEYN GİRİŞİ
// ======================================================

app.post('/api/login/parent', async (req, res) => {
  try {

    const { code } =
      req.body;

    if (!code) {

      return res.status(400).json({
        success: false,
        message:
          'Kod boş ola bilməz!'
      });

    }


    const studentResult =
      await pool.query(`
        SELECT
          id,
          student_name AS "studentName",
          student_code AS "studentCode",
          parent_name AS "parentName",
          parent_code AS "parentCode",
          student_class AS "studentClass"
        FROM students
        WHERE LOWER(parent_code) = LOWER($1)
        LIMIT 1
      `, [
        code.trim()
      ]);


    if (
      studentResult.rows.length === 0
    ) {

      return res.status(404).json({
        success: false,
        message:
          'Valideyn kodu tapılmadı!'
      });

    }


    const student =
      studentResult.rows[0];


    const scoresResult =
      await pool.query(`
        SELECT
          id,
          type,
          title,
          score,
          created_at AS "createdAt"
        FROM scores
        WHERE student_id = $1
        ORDER BY created_at DESC
      `, [
        student.id
      ]);


    const attendanceResult =
      await pool.query(`
        SELECT
          id,
          lesson_date AS "lessonDate",
          status
        FROM attendance
        WHERE student_id = $1
        ORDER BY lesson_date DESC
      `, [
        student.id
      ]);


    const teacherNotesResult =
      await pool.query(`
        SELECT
          id,
          note,
          created_at AS "createdAt"
        FROM teacher_notes
        WHERE student_id = $1
        ORDER BY created_at DESC
      `, [
        student.id
      ]);


    res.json({
      success: true,

      student: {
        ...student,

        scores:
          scoresResult.rows,

        attendance:
          attendanceResult.rows,

        teacherNotes:
          teacherNotesResult.rows
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message:
        'Server xətası'
    });

  }
});


// ======================================================
// 13. ANA SƏHİFƏ ÜÇÜN REAL STATİSTİKA
// ======================================================

app.get('/api/stats', async (req, res) => {
  try {

    const studentsResult =
      await pool.query(`
        SELECT
          COUNT(*)::int AS count
        FROM students
      `);


    const examsResult =
      await pool.query(`
        SELECT
          COUNT(*)::int AS count
        FROM scores
      `);


    const dimResult =
      await pool.query(`
        SELECT
          ROUND(
            AVG(score)::numeric,
            1
          ) AS average
        FROM scores
        WHERE LOWER(type) =
              LOWER('DİM Sınağı')
      `);


    const attendanceResult =
      await pool.query(`
        SELECT
          COUNT(*)::int AS total,

          COUNT(*) FILTER (
            WHERE status = 'present'
          )::int AS present

        FROM attendance
      `);


    const studentCount =
      studentsResult.rows[0].count || 0;


    const examCount =
      examsResult.rows[0].count || 0;


    const averageDimScore =
      dimResult.rows[0].average !== null
        ? Number(
            dimResult.rows[0].average
          )
        : 0;


    const totalAttendance =
      attendanceResult.rows[0].total || 0;


    const presentAttendance =
      attendanceResult.rows[0].present || 0;


    const attendanceRate =
      totalAttendance > 0
        ? Math.round(
            (
              presentAttendance /
              totalAttendance
            ) * 100
          )
        : 0;


    res.json({
      success: true,
      studentCount,
      examCount,
      averageDimScore,
      attendanceRate
    });

  } catch (error) {

    console.error(
      '❌ Statistika xətası:',
      error
    );

    res.status(500).json({
      success: false,
      message:
        'Statistika məlumatları alınarkən xəta baş verdi'
    });

  }
});


// ======================================================
// TEST ROUTE
// ======================================================

app.get('/api/test', async (req, res) => {
  try {

    const result =
      await pool.query(
        'SELECT NOW() AS current_time'
      );

    res.json({
      success: true,
      message:
        'EduTrack PostgreSQL ilə işləyir!',
      databaseTime:
        result.rows[0].current_time
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message:
        'Database bağlantı xətası'
    });

  }
});


// ======================================================
// SERVERİ BAŞLAT
// ======================================================

async function startServer() {
  try {

    await initDatabase();

    const server =
      app.listen(
        PORT,
        '0.0.0.0',
        () => {

          console.log(
            `🚀 EduTrack Serveri http://127.0.0.1:${PORT} ünvanında aktivdir!`
          );

          console.log(
            '🟢 Server prosesi işləyir...'
          );

        }
      );


    server.on(
      'error',
      (error) => {

        console.error(
          '❌ SERVER ERROR:',
          error
        );

      }
    );


    server.on(
      'close',
      () => {

        console.log(
          '🔴 Server bağlandı!'
        );

      }
    );

  } catch (error) {

    console.error(
      '❌ Server başladılarkən xəta:',
      error
    );

  }
}


// ======================================================
// DEBUG
// ======================================================

process.on(
  'exit',
  (code) => {

    console.log(
      '⚠️ Node prosesi bağlanır. Exit code:',
      code
    );

  }
);


process.on(
  'uncaughtException',
  (error) => {

    console.error(
      '❌ UNCAUGHT EXCEPTION:',
      error
    );

  }
);


process.on(
  'unhandledRejection',
  (reason) => {

    console.error(
      '❌ UNHANDLED REJECTION:',
      reason
    );

  }
);


startServer();