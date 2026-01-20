// Firebase Configuration
        const firebaseConfig = {
    apiKey: "AIzaSyAYWc_v9yU3MznJK6mjwT4sXMQkYB_1FIM",
    authDomain: "thanaweia.firebaseapp.com",
    projectId: "thanaweia",
    storageBucket: "thanaweia.firebasestorage.app",
    messagingSenderId: "11554029152",
    appId: "1:11554029152:web:4c809b1e8fa57af2454d05",
    measurementId: "G-3YR6NPJ0VE"
        };

        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.firestore();

        // Global State
        let currentUser = null;
        let currentFilter = 'all';
        let currentChapterFilter = 'all';
        let currentReviewQuestion = null;
        let currentNoteQuestionId = null;
        let choiceCounter = 2;
        let deferredPrompt = null;
        let currentImageFile = null;
        let currentImageDataUrl = null;
        let mediaRecorder = null;
        let audioChunks = [];
        let recordingInterval = null;
        let recordingStartTime = 0;
        let currentVoiceNote = null;
        let currentNoteType = 'text';
        let editorCanvas = null;
        let editorCtx = null;
        let editorImage = null;
        let rotationAngle = 0;
        let currentEditChapterId = null;
        let allQuestionsCache = [];
        
        // Swipe Review State
        let reviewQueue = [];
        let currentCardIndex = 0;
        let swipeStartX = 0;
        let swipeStartY = 0;
        let currentX = 0;
        let currentY = 0;
        let isDragging = false;
        let correctAnswers = 0;
        let wrongAnswers = 0;
        let skippedQuestions = [];

        // Notification System
        let notificationTimers = [];
        const NOTIFICATION_TIMES = {
            morning: { hour: 8, minute: 0, message: 'صباح الخير! 🌅\nلديك {count} للمراجعة اليوم' },
            afternoon: { hour: 14, minute: 0, message: 'تذكير! ⏰\nلم تراجع بعد. لديك {count} في انتظارك' },
            evening: { hour: 19, minute: 0, message: 'آخر فرصة! 🌆\n{count} تنتظر المراجعة' },
            night: { hour: 22, minute: 0, message: 'قبل النوم! 🌙\nلا تنسى المراجعة: {count}' }
        };

        // Spaced Repetition Configuration
        const MAX_REVIEW_STAGE = 6;
        const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 90]; // days

        // AUTH GUARD - Single Source of Truth
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                document.getElementById('authScreen').classList.add('hidden');
                document.getElementById('mainApp').classList.remove('hidden');
                
                const displayName = user.displayName || user.email.split('@')[0];
                document.getElementById('userEmail').textContent = user.email;
                document.getElementById('headerTitle').textContent = `مرحباً ${displayName} 👋`;
                
                await loadUserData();
                requestNotificationPermission();
                await checkDailyNotification();
            } else {
                currentUser = null;
                document.getElementById('authScreen').classList.remove('hidden');
                document.getElementById('mainApp').classList.add('hidden');
            }
        });

        // Authentication Functions
        function showLogin() {
            document.getElementById('loginForm').classList.remove('hidden');
            document.getElementById('registerForm').classList.add('hidden');
            clearAuthMessage();
        }

        function showRegister() {
            document.getElementById('loginForm').classList.add('hidden');
            document.getElementById('registerForm').classList.remove('hidden');
            clearAuthMessage();
        }

        async function login() {
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            if (!email || !password) {
                showAuthMessage('الرجاء إدخال البريد الإلكتروني وكلمة المرور', 'error');
                return;
            }

            try {
                await auth.signInWithEmailAndPassword(email, password);
            } catch (error) {
                console.error('Login error:', error);
                showAuthMessage(getErrorMessage(error.code), 'error');
            }
        }

        async function register() {
            const name = document.getElementById('registerName').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const password = document.getElementById('registerPassword').value;

            if (!name || !email || !password) {
                showAuthMessage('الرجاء إدخال جميع البيانات', 'error');
                return;
            }

            if (password.length < 6) {
                showAuthMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
                return;
            }

            try {
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                await userCredential.user.updateProfile({ displayName: name });
                await db.collection('users').doc(userCredential.user.uid).set({
                    name: name,
                    email: email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                showAuthMessage('تم إنشاء الحساب بنجاح!', 'success');
            } catch (error) {
                console.error('Register error:', error);
                showAuthMessage(getErrorMessage(error.code), 'error');
            }
        }

        async function loginWithGoogle() {
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                
                const result = await auth.signInWithPopup(provider);
                const user = result.user;
                
                await db.collection('users').doc(user.uid).set({
                    name: user.displayName,
                    email: user.email,
                    photoURL: user.photoURL,
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
            } catch (error) {
                console.error('Google login error:', error);
                if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
                    showAuthMessage(getErrorMessage(error.code), 'error');
                }
            }
        }

        function logout() {
            auth.signOut();
        }

        function showAuthMessage(message, type) {
            const messageDiv = document.getElementById('authMessage');
            messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
            messageDiv.textContent = message;
        }

        function clearAuthMessage() {
            document.getElementById('authMessage').innerHTML = '';
        }

        function getErrorMessage(code) {
            const errors = {
                'auth/email-already-in-use': 'البريد الإلكتروني مستخدم بالفعل',
                'auth/invalid-email': 'البريد الإلكتروني غير صحيح',
                'auth/user-not-found': 'المستخدم غير موجود',
                'auth/wrong-password': 'كلمة المرور غير صحيحة',
                'auth/weak-password': 'كلمة المرور ضعيفة جداً',
                'auth/network-request-failed': 'خطأ في الاتصال بالإنترنت',
                'auth/popup-blocked': 'تم حظر النافذة المنبثقة',
                'auth/too-many-requests': 'محاولات كثيرة. حاول لاحقاً'
            };
            return errors[code] || 'حدث خطأ. الرجاء المحاولة مرة أخرى';
        }

        // Spaced Repetition Algorithm
        function calculateNextReview(stage, correct) {
            let newStage;
            
            if (correct) {
                newStage = Math.min(stage + 1, MAX_REVIEW_STAGE);
            } else {
                newStage = 0;
            }
            
            const days = REVIEW_INTERVALS[newStage];
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + days);
            nextDate.setHours(0, 0, 0, 0);
            
            return { stage: newStage, date: nextDate };
        }

        // Question Management Functions
        function toggleChoices() {
            const checkbox = document.getElementById('hasChoices');
            const container = document.getElementById('choicesContainer');
            
            if (checkbox.checked) {
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        }

        function addChoice() {
            const choicesList = document.getElementById('choicesList');
            const choiceLabels = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
            
            const choiceItem = document.createElement('div');
            choiceItem.className = 'choice-item';
            choiceItem.setAttribute('data-index', choiceCounter);
            
            const label = choiceLabels[choiceCounter] || String.fromCharCode(65 + choiceCounter);
            
            choiceItem.innerHTML = `
                <div style="display: flex; gap: 10px; align-items: start; margin-bottom: 10px;">
                    <input type="radio" name="correctChoice" value="${choiceCounter}" style="margin-top: 12px; cursor: pointer;">
                    <input type="text" class="choice-input" placeholder="الاختيار ${label}" style="flex: 1; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);">
                    <button type="button" class="btn-small btn-danger" onclick="removeChoice(${choiceCounter})" style="padding: 8px 12px;">×</button>
                </div>
            `;
            
            choicesList.appendChild(choiceItem);
            choiceCounter++;
        }

        function removeChoice(index) {
            const choiceItems = document.querySelectorAll('.choice-item');
            if (choiceItems.length <= 2) {
                alert('⚠️ يجب أن يكون هناك اختياريين على الأقل');
                return;
            }
            
            const choiceItem = document.querySelector(`.choice-item[data-index="${index}"]`);
            if (choiceItem) {
                choiceItem.remove();
            }
        }

        // Image Handling Functions
        function captureImage() {
            document.getElementById('imageInput').click();
        }

        function uploadImage() {
            document.getElementById('uploadInput').click();
        }

        function handleImageSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            // عرض حجم الملف الأصلي
            const fileSizeKB = (file.size / 1024).toFixed(2);
            console.log(`حجم الصورة الأصلي: ${fileSizeKB} KB`);

            currentImageFile = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                compressImage(e.target.result, (compressedDataUrl) => {
                    currentImageDataUrl = compressedDataUrl;
                    document.getElementById('previewImg').src = compressedDataUrl;
                    document.getElementById('imagePreview').classList.remove('hidden');
                    
                    // عرض حجم الصورة بعد الضغط
                    const compressedSizeKB = ((compressedDataUrl.length * 3) / 4 / 1024).toFixed(2);
                    console.log(`حجم الصورة بعد الضغط: ${compressedSizeKB} KB`);
                    
                    // تنبيه إذا كانت الصورة لا تزال كبيرة
                    if (compressedSizeKB > 500) {
                        console.warn('⚠️ الصورة كبيرة نسبياً. قد يستغرق الحفظ وقتاً أطول.');
                    }
                });
            };
            reader.readAsDataURL(file);
        }

        // دالة ضغط الصور
        function compressImage(dataUrl, callback, quality = 0.7, maxWidth = 1200, maxHeight = 1200) {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // حساب الأبعاد الجديدة مع الحفاظ على النسبة
                if (width > maxWidth || height > maxHeight) {
                    const aspectRatio = width / height;
                    if (width > height) {
                        width = maxWidth;
                        height = width / aspectRatio;
                    } else {
                        height = maxHeight;
                        width = height * aspectRatio;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // ضغط الصورة
                let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                
                // إذا كانت الصورة لا تزال كبيرة جداً (أكثر من 800KB)
                const sizeInKB = (compressedDataUrl.length * 3) / 4 / 1024;
                if (sizeInKB > 800 && quality > 0.3) {
                    // محاولة ضغط أكثر
                    compressImage(dataUrl, callback, quality - 0.1, maxWidth, maxHeight);
                } else {
                    callback(compressedDataUrl);
                }
            };
            img.src = dataUrl;
        }

        function removeImage() {
            currentImageFile = null;
            currentImageDataUrl = null;
            document.getElementById('imagePreview').classList.add('hidden');
            document.getElementById('imageInput').value = '';
            document.getElementById('uploadInput').value = '';
        }

        // Image Editor Functions
        function openImageEditor() {
            if (!currentImageDataUrl) return;

            const modal = document.getElementById('imageEditorModal');
            modal.classList.remove('hidden');

            const canvas = document.getElementById('editorCanvas');
            editorCanvas = canvas;
            editorCtx = canvas.getContext('2d');

            const img = new Image();
            img.onload = () => {
                editorImage = img;
                rotationAngle = 0;
                drawImageOnCanvas();
            };
            img.src = currentImageDataUrl;
        }

        function drawImageOnCanvas() {
            if (!editorImage || !editorCanvas) return;

            const maxWidth = window.innerWidth - 100;
            const maxHeight = window.innerHeight - 300;

            let width = editorImage.width;
            let height = editorImage.height;

            if (rotationAngle % 180 !== 0) {
                [width, height] = [height, width];
            }

            const scale = Math.min(maxWidth / width, maxHeight / height, 1);
            const scaledWidth = width * scale;
            const scaledHeight = height * scale;

            editorCanvas.width = scaledWidth;
            editorCanvas.height = scaledHeight;

            editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
            editorCtx.save();
            editorCtx.translate(editorCanvas.width / 2, editorCanvas.height / 2);
            editorCtx.rotate((rotationAngle * Math.PI) / 180);
            editorCtx.drawImage(editorImage, -editorImage.width * scale / 2, -editorImage.height * scale / 2, editorImage.width * scale, editorImage.height * scale);
            editorCtx.restore();
        }

        function rotateImage() {
            rotationAngle = (rotationAngle + 90) % 360;
            drawImageOnCanvas();
        }

        function cropImage() {
            alert('💡 لقص الصورة: استخدم تطبيق الصور في هاتفك قبل رفعها، أو سنضيف هذه الميزة قريباً');
        }

        function saveEditedImage() {
            if (!editorCanvas) return;

            const tempDataUrl = editorCanvas.toDataURL('image/jpeg', 0.9);
            compressImage(tempDataUrl, (compressedDataUrl) => {
                currentImageDataUrl = compressedDataUrl;
                document.getElementById('previewImg').src = compressedDataUrl;
                closeImageEditor();
            });
        }

        function closeImageEditor() {
            document.getElementById('imageEditorModal').classList.add('hidden');
            editorCanvas = null;
            editorCtx = null;
        }

        // Chapters Management
        async function loadChapters() {
            const subject = document.getElementById('questionSubject').value;
            const chapterGroup = document.getElementById('chapterGroup');
            const chapterSelect = document.getElementById('questionChapter');

            if (!subject) {
                chapterGroup.style.display = 'none';
                return;
            }

            chapterGroup.style.display = 'block';
            chapterSelect.innerHTML = '<option value="">اختر الباب</option>';

            if (!currentUser) return;

            try {
                const snapshot = await db.collection('chapters')
                    .where('userId', '==', currentUser.uid)
                    .where('subject', '==', subject)
                    .get();

                snapshot.docs.forEach(doc => {
                    const chapter = doc.data();
                    const option = document.createElement('option');
                    option.value = chapter.name;
                    option.textContent = chapter.name;
                    chapterSelect.appendChild(option);
                });
            } catch (error) {
                console.error('Load chapters error:', error);
            }
        }

        function showAddChapterModal() {
            const subject = document.getElementById('questionSubject').value;
            if (!subject) {
                alert('⚠️ اختر المادة أولاً');
                return;
            }
            document.getElementById('addChapterModal').classList.remove('hidden');
        }

        function closeAddChapterModal(event) {
            if (event && event.target.id !== 'addChapterModal') return;
            document.getElementById('addChapterModal').classList.add('hidden');
            document.getElementById('newChapterName').value = '';
        }

        async function saveNewChapter() {
            const subject = document.getElementById('questionSubject').value;
            const chapterName = document.getElementById('newChapterName').value.trim();

            if (!chapterName) {
                alert('⚠️ أدخل اسم الباب');
                return;
            }

            if (!currentUser) {
                alert('❌ يجب تسجيل الدخول أولاً');
                return;
            }

            try {
                // Check if chapter already exists
                const existingChapters = await db.collection('chapters')
                    .where('userId', '==', currentUser.uid)
                    .where('subject', '==', subject)
                    .where('name', '==', chapterName)
                    .get();

                if (!existingChapters.empty) {
                    alert('⚠️ هذا الباب موجود بالفعل');
                    return;
                }

                // Add new chapter
                await db.collection('chapters').add({
                    userId: currentUser.uid,
                    subject: subject,
                    name: chapterName,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                closeAddChapterModal();
                await loadChapters();
                
                // Select the newly added chapter
                setTimeout(() => {
                    document.getElementById('questionChapter').value = chapterName;
                }, 300);
                
                alert('✅ تم إضافة الباب بنجاح');
            } catch (error) {
                console.error('Save chapter error:', error);
                alert('❌ حدث خطأ أثناء حفظ الباب: ' + error.message + '\n\nتأكد من الاتصال بالإنترنت.');
            }
        }

        async function showManageChaptersModal() {
            const subject = document.getElementById('questionSubject').value;
            if (!subject) {
                alert('⚠️ اختر المادة أولاً');
                return;
            }

            document.getElementById('manageChaptersModal').classList.remove('hidden');
            await loadChaptersForManage(subject);
        }

        function closeManageChaptersModal(event) {
            if (event && event.target.id !== 'manageChaptersModal') return;
            document.getElementById('manageChaptersModal').classList.add('hidden');
        }

        async function loadChaptersForManage(subject) {
            const container = document.getElementById('chaptersListManage');
            container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

            try {
                const snapshot = await db.collection('chapters')
                    .where('userId', '==', currentUser.uid)
                    .where('subject', '==', subject)
                    .get();

                if (snapshot.empty) {
                    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد أبواب لهذه المادة</p>';
                    return;
                }

                const html = snapshot.docs.map(doc => {
                    const chapter = doc.data();
                    return `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 10px; border-right: 4px solid var(--accent);">
                            <span style="font-weight: 600;">${chapter.name}</span>
                            <div style="display: flex; gap: 8px;">
                                <button class="btn-small" onclick="editChapter('${doc.id}', '${chapter.name.replace(/'/g, "\\'")}', '${subject}')" style="background: var(--gradient-3); color: white;">✏️ تعديل</button>
                                <button class="btn-small btn-danger" onclick="deleteChapter('${doc.id}', '${subject}')">🗑️ حذف</button>
                            </div>
                        </div>
                    `;
                }).join('');

                container.innerHTML = html;
            } catch (error) {
                console.error('Load chapters for manage error:', error);
                container.innerHTML = '<p style="text-align: center; color: var(--danger); padding: 20px;">حدث خطأ في تحميل الأبواب</p>';
            }
        }

        function editChapter(chapterId, chapterName, subject) {
            currentEditChapterId = chapterId;
            document.getElementById('editChapterName').value = chapterName;
            document.getElementById('editChapterModal').classList.remove('hidden');
        }

        function closeEditChapterModal(event) {
            if (event && event.target.id !== 'editChapterModal') return;
            document.getElementById('editChapterModal').classList.add('hidden');
            currentEditChapterId = null;
        }

        async function updateChapter() {
            if (!currentEditChapterId) return;

            const newName = document.getElementById('editChapterName').value.trim();
            if (!newName) {
                alert('⚠️ أدخل اسم الباب');
                return;
            }

            try {
                await db.collection('chapters').doc(currentEditChapterId).update({
                    name: newName
                });

                closeEditChapterModal();
                const subject = document.getElementById('questionSubject').value;
                await loadChaptersForManage(subject);
                await loadChapters();
                alert('✅ تم تعديل الباب بنجاح');
            } catch (error) {
                console.error('Update chapter error:', error);
                alert('❌ حدث خطأ أثناء التعديل: ' + error.message);
            }
        }

        async function deleteChapter(chapterId, subject) {
            if (!confirm('هل أنت متأكد من حذف هذا الباب؟\n\nملاحظة: لن يتم حذف الأسئلة المرتبطة به')) return;

            try {
                await db.collection('chapters').doc(chapterId).delete();
                await loadChaptersForManage(subject);
                await loadChapters();
                alert('✅ تم حذف الباب بنجاح');
            } catch (error) {
                console.error('Delete chapter error:', error);
                alert('❌ حدث خطأ أثناء الحذف: ' + error.message);
            }
        }

        // Voice Recording Functions
        function switchNoteType(type) {
            currentNoteType = type;
            
            if (type === 'text') {
                document.getElementById('textNoteSection').classList.remove('hidden');
                document.getElementById('voiceNoteSection').classList.add('hidden');
                document.getElementById('noteTypeText').style.background = 'var(--accent)';
                document.getElementById('noteTypeText').style.color = 'white';
                document.getElementById('noteTypeVoice').style.background = 'var(--bg-tertiary)';
                document.getElementById('noteTypeVoice').style.color = 'var(--text-secondary)';
            } else {
                document.getElementById('textNoteSection').classList.add('hidden');
                document.getElementById('voiceNoteSection').classList.remove('hidden');
                document.getElementById('noteTypeVoice').style.background = 'var(--accent)';
                document.getElementById('noteTypeVoice').style.color = 'white';
                document.getElementById('noteTypeText').style.background = 'var(--bg-tertiary)';
                document.getElementById('noteTypeText').style.color = 'var(--text-secondary)';
            }
        }

        async function startRecording() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const audioUrl = URL.createObjectURL(audioBlob);
                    currentVoiceNote = audioBlob;
                    
                    // Use custom audio player
                    createCustomAudioPlayer(audioUrl, 'customAudioPlayerContainer');
                    document.getElementById('audioPlaybackSection').classList.remove('hidden');
                    
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                recordingStartTime = Date.now();
                
                document.getElementById('startRecordBtn').classList.add('hidden');
                document.getElementById('stopRecordBtn').classList.remove('hidden');
                document.getElementById('recordingIndicator').classList.remove('hidden');

                recordingInterval = setInterval(() => {
                    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
                    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                    const seconds = (elapsed % 60).toString().padStart(2, '0');
                    document.getElementById('recordingTime').textContent = `${minutes}:${seconds}`;
                }, 1000);

            } catch (error) {
                console.error('Recording error:', error);
                alert('❌ فشل الوصول للميكروفون. تأكد من الأذونات.');
            }
        }

        function stopRecording() {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                clearInterval(recordingInterval);
                
                document.getElementById('startRecordBtn').classList.remove('hidden');
                document.getElementById('stopRecordBtn').classList.add('hidden');
                document.getElementById('recordingIndicator').classList.add('hidden');
            }
        }

        function deleteVoiceNote() {
            currentVoiceNote = null;
            document.getElementById('audioPlaybackSection').classList.add('hidden');
            document.getElementById('customAudioPlayerContainer').innerHTML = '';
        }

        // Image Fullscreen View
        function openFullscreenImage(src) {
            document.getElementById('fullscreenImg').src = src;
            document.getElementById('imageFullscreen').classList.remove('hidden');
        }

        function closeFullscreenImage() {
            document.getElementById('imageFullscreen').classList.add('hidden');
        }

        // Custom Audio Player
        function createCustomAudioPlayer(audioSrc, containerId) {
            const container = document.getElementById(containerId) || document.createElement('div');
            
            const playerHTML = `
                <div class="custom-audio-player">
                    <div class="audio-controls">
                        <button class="audio-play-btn" onclick="toggleAudioPlay(this)">
                            ▶️
                        </button>
                        <div class="audio-timeline">
                            <div class="audio-progress-bar" onclick="seekAudio(event, this)">
                                <div class="audio-progress-fill" style="width: 0%"></div>
                            </div>
                            <div class="audio-times">
                                <span class="current-time">0:00</span>
                                <span class="total-time">0:00</span>
                            </div>
                        </div>
                        <div class="audio-wave paused">
                            <div class="audio-wave-bar"></div>
                            <div class="audio-wave-bar"></div>
                            <div class="audio-wave-bar"></div>
                            <div class="audio-wave-bar"></div>
                            <div class="audio-wave-bar"></div>
                        </div>
                    </div>
                    <audio style="display: none;" preload="metadata">
                        <source src="${audioSrc}" type="audio/webm">
                    </audio>
                </div>
            `;

            container.innerHTML = playerHTML;

            const audio = container.querySelector('audio');
            const progressFill = container.querySelector('.audio-progress-fill');
            const currentTimeEl = container.querySelector('.current-time');
            const totalTimeEl = container.querySelector('.total-time');

            audio.addEventListener('loadedmetadata', () => {
                totalTimeEl.textContent = formatTime(audio.duration);
            });

            audio.addEventListener('timeupdate', () => {
                const progress = (audio.currentTime / audio.duration) * 100;
                progressFill.style.width = progress + '%';
                currentTimeEl.textContent = formatTime(audio.currentTime);
            });

            audio.addEventListener('ended', () => {
                const playBtn = container.querySelector('.audio-play-btn');
                const wave = container.querySelector('.audio-wave');
                playBtn.textContent = '▶️';
                wave.classList.add('paused');
                progressFill.style.width = '0%';
            });

            return container;
        }

        function toggleAudioPlay(button) {
            const player = button.closest('.custom-audio-player');
            const audio = player.querySelector('audio');
            const wave = player.querySelector('.audio-wave');

            if (audio.paused) {
                audio.play();
                button.textContent = '⏸️';
                wave.classList.remove('paused');
            } else {
                audio.pause();
                button.textContent = '▶️';
                wave.classList.add('paused');
            }
        }

        function seekAudio(event, progressBar) {
            const player = progressBar.closest('.custom-audio-player');
            const audio = player.querySelector('audio');
            const rect = progressBar.getBoundingClientRect();
            const percent = (event.clientX - rect.left) / rect.width;
            audio.currentTime = percent * audio.duration;
        }

        function formatTime(seconds) {
            if (isNaN(seconds)) return '0:00';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        async function addQuestion() {
            // Check auth first
            if (!currentUser) {
                alert('❌ يجب تسجيل الدخول أولاً');
                return;
            }

            const text = document.getElementById('questionText').value.trim();
            const subject = document.getElementById('questionSubject').value;
            const chapter = document.getElementById('questionChapter').value;
            const type = document.getElementById('questionType').value;
            const hasChoices = document.getElementById('hasChoices').checked;

            // Either text or image must be provided
            if (!text && !currentImageDataUrl) {
                alert('⚠️ الرجاء إدخال نص السؤال أو إضافة صورة');
                return;
            }

            if (!subject) {
                alert('⚠️ الرجاء اختيار المادة');
                return;
            }

            let choices = null;
            let correctAnswerIndex = null;

            if (hasChoices) {
                const choiceInputs = document.querySelectorAll('.choice-input');
                const correctRadio = document.querySelector('input[name="correctChoice"]:checked');
                
                choices = Array.from(choiceInputs)
                    .map(input => input.value.trim())
                    .filter(val => val !== '');

                if (choices.length < 2) {
                    alert('⚠️ الرجاء إدخال اختيارين على الأقل');
                    return;
                }

                if (!correctRadio) {
                    alert('⚠️ الرجاء تحديد الإجابة الصحيحة');
                    return;
                }

                correctAnswerIndex = parseInt(correctRadio.value);
                const allChoiceItems = document.querySelectorAll('.choice-item');
                const validIndices = Array.from(allChoiceItems).map(item => 
                    parseInt(item.getAttribute('data-index'))
                );
                correctAnswerIndex = validIndices.indexOf(correctAnswerIndex);
            }

            // Show loading indicator
            const addBtn = event.target;
            const originalText = addBtn.textContent;
            addBtn.textContent = '⏳ جاري الحفظ...';
            addBtn.disabled = true;

            try {
                const nextReview = new Date();
                nextReview.setDate(nextReview.getDate() + 1);
                nextReview.setHours(0, 0, 0, 0);

                const questionData = {
                    userId: currentUser.uid,
                    text: text,
                    subject: subject,
                    chapter: chapter || '',
                    type: type,
                    errorCount: 0,
                    reviewStage: 0,
                    nextReview: firebase.firestore.Timestamp.fromDate(nextReview),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastReviewed: null,
                    note: '',
                    noteType: 'text',
                    voiceNoteUrl: '',
                    hasChoices: hasChoices,
                    choices: choices,
                    correctAnswerIndex: correctAnswerIndex,
                    imageUrl: currentImageDataUrl || ''
                };

                await db.collection('questions').add(questionData);

                // Reset form
                document.getElementById('questionText').value = '';
                document.getElementById('questionSubject').value = '';
                document.getElementById('questionChapter').value = '';
                document.getElementById('hasChoices').checked = false;
                document.getElementById('choicesContainer').classList.add('hidden');
                document.getElementById('chapterGroup').style.display = 'none';
                removeImage();
                
                // Reset choices
                document.getElementById('choicesList').innerHTML = `
                    <div class="choice-item" data-index="0">
                        <div style="display: flex; gap: 10px; align-items: start; margin-bottom: 10px;">
                            <input type="radio" name="correctChoice" value="0" style="margin-top: 12px; cursor: pointer;">
                            <input type="text" class="choice-input" placeholder="الاختيار أ" style="flex: 1; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);">
                            <button type="button" class="btn-small btn-danger" onclick="removeChoice(0)" style="padding: 8px 12px;">×</button>
                        </div>
                    </div>
                    <div class="choice-item" data-index="1">
                        <div style="display: flex; gap: 10px; align-items: start; margin-bottom: 10px;">
                            <input type="radio" name="correctChoice" value="1" style="margin-top: 12px; cursor: pointer;">
                            <input type="text" class="choice-input" placeholder="الاختيار ب" style="flex: 1; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);">
                            <button type="button" class="btn-small btn-danger" onclick="removeChoice(1)" style="padding: 8px 12px;">×</button>
                        </div>
                    </div>
                `;
                choiceCounter = 2;
                
                addBtn.textContent = originalText;
                addBtn.disabled = false;
                
                alert('✅ تم إضافة السؤال بنجاح!');
                await loadUserData();
            } catch (error) {
                console.error('Add question error:', error);
                addBtn.textContent = originalText;
                addBtn.disabled = false;
                
                if (error.code === 'resource-exhausted') {
                    alert('❌ الصورة كبيرة جداً. حاول استخدام صورة أصغر حجماً.');
                } else {
                    alert('❌ حدث خطأ أثناء إضافة السؤال. تأكد من الاتصال بالإنترنت.\n\nالخطأ: ' + error.message);
                }
            }
        }

        async function deleteQuestion(id) {
            if (!confirm('هل أنت متأكد من حذف هذا السؤال؟')) return;

            if (!currentUser) {
                alert('❌ يجب تسجيل الدخول أولاً');
                return;
            }

            // Show loading indicator
            const deleteBtn = event.target;
            const originalText = deleteBtn.textContent;
            deleteBtn.textContent = '⏳';
            deleteBtn.disabled = true;

            try {
                await db.collection('questions').doc(id).delete();
                alert('✅ تم حذف السؤال بنجاح');
                
                // Reload data
                await loadUserData();
                
                // Refresh gallery if we're on gallery tab
                const activeTab = document.querySelector('.nav-tab.active, .bottom-nav-item.active');
                if (activeTab && activeTab.textContent.includes('المعرض')) {
                    await loadGallery();
                }
            } catch (error) {
                console.error('Delete error:', error);
                deleteBtn.textContent = originalText;
                deleteBtn.disabled = false;
                alert('❌ حدث خطأ أثناء الحذف: ' + error.message);
            }
        }

        // Data Loading from Firestore (Single Source of Truth)
        async function loadUserData() {
            if (!currentUser) return;

            try {
                const snapshot = await db.collection('questions')
                    .where('userId', '==', currentUser.uid)
                    .get();

                // Update stats directly from Firestore
                const totalQuestions = snapshot.size;
                
                const today = new Date();
                today.setHours(23, 59, 59, 999);

                let todayReview = 0;
                let errorQuestions = 0;
                const subjectCounts = {};

                snapshot.docs.forEach(doc => {
                    const data = doc.data();
                    
                    // Count questions due today
                    if (data.nextReview && data.nextReview.toDate() <= today) {
                        todayReview++;
                    }
                    
                    // Count error questions
                    if (data.errorCount > 0) {
                        errorQuestions++;
                    }
                    
                    // Count by subject
                    if (data.subject) {
                        subjectCounts[data.subject] = (subjectCounts[data.subject] || 0) + 1;
                    }
                });

                // Update stats display
                document.getElementById('totalQuestions').textContent = totalQuestions;
                document.getElementById('todayReview').textContent = todayReview;
                document.getElementById('errorCount').textContent = errorQuestions;

                // Update subject distribution
                updateSubjectDistribution(subjectCounts, totalQuestions);
            } catch (error) {
                console.error('Load data error:', error);
                alert('❌ حدث خطأ في تحميل البيانات. تأكد من الاتصال بالإنترنت.');
            }
        }

        function updateSubjectDistribution(subjectCounts, total) {
            const subjects = ['أحياء', 'جيولوجيا', 'كيمياء', 'فيزياء', 'رياضة', 'عربي', 'إنجليزي'];
            const container = document.getElementById('subjectDistribution');
            container.innerHTML = '';

            subjects.forEach(subject => {
                const count = subjectCounts[subject] || 0;
                if (count === 0) return;
                
                const percentage = total > 0 ? (count / total * 100).toFixed(1) : 0;

                const item = document.createElement('div');
                item.style.marginBottom = '15px';
                item.innerHTML = `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span>${subject}</span>
                        <span style="color: var(--accent); font-weight: 600;">${count} سؤال (${percentage}%)</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                `;
                container.appendChild(item);
            });

            if (container.children.length === 0) {
                container.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">لم تقم بإضافة أي أسئلة بعد</p>';
            }
        }

        // Review System - Load from Firestore directly
        async function loadReviewQuestions() {
            const container = document.getElementById('reviewContent');
            
            if (!currentUser) {
                container.innerHTML = '<p style="color: var(--danger);">الرجاء تسجيل الدخول</p>';
                return;
            }

            container.innerHTML = '<div class="loading"><div class="spinner"></div><p style="margin-top: 15px;">جاري التحميل...</p></div>';

            try {
                const today = new Date();
                today.setHours(23, 59, 59, 999);

                // Query only questions due for review
                const snapshot = await db.collection('questions')
                    .where('userId', '==', currentUser.uid)
                    .get();

                // Filter and sort in memory
                const reviewQueue = snapshot.docs
                    .map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }))
                    .filter(q => q.nextReview && q.nextReview.toDate() <= today)
                    .sort((a, b) => {
                        // Priority: errors first, then oldest review date
                        if (a.errorCount !== b.errorCount) {
                            return b.errorCount - a.errorCount;
                        }
                        return a.nextReview.toDate() - b.nextReview.toDate();
                    });

                if (reviewQueue.length === 0) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            <h3 style="color: var(--text-primary); margin-bottom: 10px;">🎉 رائع!</h3>
                            <p>لا توجد أسئلة مستحقة للمراجعة اليوم</p>
                            <p style="margin-top: 10px;">لقد أنجزت مهمتك اليومية بنجاح! 💪</p>
                        </div>
                    `;
                } else {
                    showNextReviewQuestion(reviewQueue);
                }
            } catch (error) {
                console.error('Load review error:', error);
                container.innerHTML = '<p style="color: var(--danger);">❌ حدث خطأ في تحميل الأسئلة. تأكد من الاتصال بالإنترنت.</p>';
            }
        }

        function showNextReviewQuestion(reviewQueue) {
            const container = document.getElementById('reviewContent');
            
            if (reviewQueue.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <h3 style="color: var(--text-primary); margin-bottom: 10px;">🎊 ممتاز!</h3>
                        <p>انتهيت من جميع أسئلة المراجعة اليوم</p>
                        <p style="margin-top: 10px;">استمر في التقدم الرائع! 🚀</p>
                    </div>
                `;
                loadUserData();
                return;
            }

            currentReviewQuestion = reviewQueue[0];
            const remaining = reviewQueue.length;

            let imageHTML = '';
            if (currentReviewQuestion.imageUrl) {
                imageHTML = `
                    <img src="${currentReviewQuestion.imageUrl}" class="question-image" onclick="openFullscreenImage('${currentReviewQuestion.imageUrl}')" alt="صورة السؤال">
                `;
            }

            let choicesHTML = '';
            if (currentReviewQuestion.hasChoices && currentReviewQuestion.choices) {
                choicesHTML = `
                    <div style="margin: 20px 0;">
                        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 15px; font-size: 14px;">الاختيارات:</div>
                        ${currentReviewQuestion.choices.map((choice, index) => `
                            <div style="padding: 12px; margin-bottom: 10px; background: var(--bg-tertiary); border-radius: 8px; border-right: 3px solid ${index === currentReviewQuestion.correctAnswerIndex ? 'var(--success)' : 'var(--border)'};">
                                <span style="color: var(--accent); font-weight: 600; margin-left: 10px;">${String.fromCharCode(65 + index)}.</span>
                                <span>${choice}</span>
                                ${index === currentReviewQuestion.correctAnswerIndex ? '<span style="color: var(--success); margin-right: 10px;">✓</span>' : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            let noteHTML = '';
            if (currentReviewQuestion.note || currentReviewQuestion.voiceNoteUrl) {
                if (currentReviewQuestion.noteType === 'voice' && currentReviewQuestion.voiceNoteUrl) {
                    noteHTML = `
                        <div class="note-box" style="margin-bottom: 20px;">
                            <div class="note-header">🎤 ملاحظة صوتية</div>
                            <audio controls class="audio-player" src="${currentReviewQuestion.voiceNoteUrl}" style="margin-top: 10px;"></audio>
                        </div>
                    `;
                } else if (currentReviewQuestion.note) {
                    noteHTML = `
                        <div class="note-box" style="margin-bottom: 20px;">
                            <div class="note-header">📌 ملاحظتك</div>
                            <div class="note-text">${currentReviewQuestion.note}</div>
                        </div>
                    `;
                }
            }

            container.innerHTML = `
                <div style="text-align: center; margin-bottom: 15px;">
                    <span class="badge badge-subject">${currentReviewQuestion.subject}</span>
                    ${currentReviewQuestion.chapter ? `<span class="badge" style="background: var(--success);">${currentReviewQuestion.chapter}</span>` : ''}
                    ${currentReviewQuestion.type === 'خطأ' ? '<span class="badge badge-error">خطأ</span>' : '<span class="badge badge-important">مهم</span>'}
                    <span class="badge badge-stage">المرحلة ${currentReviewQuestion.reviewStage + 1}/${MAX_REVIEW_STAGE + 1}</span>
                    ${currentReviewQuestion.errorCount > 0 ? `<span class="badge badge-error">أخطاء: ${currentReviewQuestion.errorCount}</span>` : ''}
                    ${currentReviewQuestion.hasChoices ? '<span class="badge" style="background: var(--warning);">MCQ</span>' : ''}
                </div>
                ${imageHTML}
                ${currentReviewQuestion.text ? `<div class="review-question">${currentReviewQuestion.text}</div>` : ''}
                ${choicesHTML}
                ${noteHTML}
                <div style="text-align: center; color: var(--text-secondary); margin-bottom: 20px; font-size: 14px;">
                    ${remaining} ${remaining === 1 ? 'سؤال متبقي' : 'أسئلة متبقية'}
                </div>
                <div class="review-actions">
                    <button class="btn btn-success" onclick="reviewAnswer(true)">✓ أتقنته</button>
                    <button class="btn btn-danger" onclick="reviewAnswer(false)">✗ غلطت</button>
                </div>
            `;
        }

        async function reviewAnswer(correct) {
            if (!currentReviewQuestion) return;
            if (!currentUser) {
                alert('❌ يجب تسجيل الدخول أولاً');
                return;
            }

            const { stage, date } = calculateNextReview(currentReviewQuestion.reviewStage, correct);
            
            const updateData = {
                reviewStage: stage,
                nextReview: firebase.firestore.Timestamp.fromDate(date),
                lastReviewed: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (!correct) {
                updateData.errorCount = (currentReviewQuestion.errorCount || 0) + 1;
            }

            try {
                // Update Firestore directly
                await db.collection('questions').doc(currentReviewQuestion.id).update(updateData);
                
                // Reload review questions from Firestore
                await loadReviewQuestions();
            } catch (error) {
                console.error('Review answer error:', error);
                alert('❌ حدث خطأ أثناء حفظ الإجابة. تأكد من الاتصال بالإنترنت.');
            }
        }

        // Gallery & Filtering
        async function loadGallery() {
            const container = document.getElementById('galleryList');
            container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

            if (!currentUser) {
                container.innerHTML = '<p style="color: var(--danger);">الرجاء تسجيل الدخول</p>';
                return;
            }

            try {
                const snapshot = await db.collection('questions')
                    .where('userId', '==', currentUser.uid)
                    .get();

                allQuestionsCache = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })).sort((a, b) => {
                    const dateA = a.createdAt ? a.createdAt.toDate() : new Date(0);
                    const dateB = b.createdAt ? b.createdAt.toDate() : new Date(0);
                    return dateB - dateA;
                });

                await loadChapterFilters();
                displayGalleryQuestions();
            } catch (error) {
                console.error('Load gallery error:', error);
                container.innerHTML = '<p style="color: var(--danger);">❌ حدث خطأ في تحميل الأسئلة. تأكد من الاتصال بالإنترنت.</p>';
            }
        }

        async function loadChapterFilters() {
            if (currentFilter === 'all') {
                document.getElementById('chapterFilterGroup').classList.add('hidden');
                return;
            }

            try {
                const snapshot = await db.collection('chapters')
                    .where('userId', '==', currentUser.uid)
                    .where('subject', '==', currentFilter)
                    .get();

                const container = document.getElementById('chapterFilterButtons');
                
                if (snapshot.empty) {
                    document.getElementById('chapterFilterGroup').classList.add('hidden');
                    return;
                }

                let html = '<button class="filter-btn active" onclick="filterByChapter(\'all\')">كل الأبواب</button>';
                
                snapshot.docs.forEach(doc => {
                    const chapter = doc.data();
                    html += `<button class="filter-btn" onclick="filterByChapter('${chapter.name.replace(/'/g, "\\'")}')">` + chapter.name + `</button>`;
                });

                container.innerHTML = html;
                document.getElementById('chapterFilterGroup').classList.remove('hidden');
                currentChapterFilter = 'all';
            } catch (error) {
                console.error('Load chapter filters error:', error);
            }
        }

        async function filterQuestions(subject) {
            currentFilter = subject;
            currentChapterFilter = 'all';
            
            document.querySelectorAll('.subject-filter .filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            await loadChapterFilters();
            displayGalleryQuestions();
        }

        function filterByChapter(chapter) {
            currentChapterFilter = chapter;
            
            document.querySelectorAll('#chapterFilterButtons .filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            displayGalleryQuestions();
        }

        function displayGalleryQuestions() {
            const container = document.getElementById('galleryList');
            let filtered = allQuestionsCache;

            // Filter by subject
            if (currentFilter !== 'all') {
                filtered = filtered.filter(q => q.subject === currentFilter);
            }

            // Filter by chapter
            if (currentChapterFilter !== 'all') {
                filtered = filtered.filter(q => q.chapter === currentChapterFilter);
            }

            if (filtered.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>لا توجد أسئلة${currentFilter !== 'all' ? ' في هذه المادة' : ''}${currentChapterFilter !== 'all' ? ' في هذا الباب' : ''}</p>
                    </div>
                `;
                return;
            }

            const html = filtered.map(q => {
                const nextReviewDate = q.nextReview ? q.nextReview.toDate().toLocaleDateString('ar-EG') : 'غير محدد';
                const isOverdue = q.nextReview && q.nextReview.toDate() <= new Date();
                const performanceLevel = getPerformanceLevel(q.reviewStage);
                const performanceColor = getPerformanceColor(q.reviewStage);
                
                let imageHTML = '';
                if (q.imageUrl) {
                    imageHTML = `
                        <img src="${q.imageUrl}" class="question-image" onclick="openFullscreenImage('${q.imageUrl}')" alt="صورة السؤال">
                    `;
                }

                let choicesHTML = '';
                if (q.hasChoices && q.choices) {
                    choicesHTML = `
                        <div style="margin: 15px 0; padding: 12px; background: var(--bg-primary); border-radius: 8px;">
                            <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; font-size: 13px;">الاختيارات:</div>
                            ${q.choices.map((choice, index) => `
                                <div style="padding: 8px; margin-bottom: 6px; background: ${index === q.correctAnswerIndex ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-secondary)'}; border-radius: 6px; font-size: 14px; border-right: 2px solid ${index === q.correctAnswerIndex ? 'var(--success)' : 'transparent'};">
                                    <span style="color: var(--accent); font-weight: 600; margin-left: 8px;">${String.fromCharCode(65 + index)}.</span>
                                    <span>${choice}</span>
                                    ${index === q.correctAnswerIndex ? '<span style="color: var(--success); margin-right: 8px; font-weight: 700;">✓ صح</span>' : ''}
                                </div>
                            `).join('')}
                        </div>
                    `;
                }

                let noteHTML = '';
                if (q.note || q.voiceNoteUrl) {
                    if (q.noteType === 'voice' && q.voiceNoteUrl) {
                        const audioId = `gallery-audio-${q.id}`;
                        noteHTML = `
                            <div class="note-box">
                                <div class="note-header">🎤 ملاحظة صوتية</div>
                                <div id="${audioId}"></div>
                            </div>
                        `;
                        setTimeout(() => {
                            createCustomAudioPlayer(q.voiceNoteUrl, audioId);
                        }, 100);
                    } else if (q.note) {
                        noteHTML = `
                            <div class="note-box">
                                <div class="note-header">📌 ملاحظتك</div>
                                <div class="note-text">${q.note}</div>
                            </div>
                        `;
                    }
                }
                
                return `
                    <div class="question-item" style="border-right: 4px solid ${performanceColor};">
                        <div class="question-header">
                            <div class="question-badges">
                                <span class="badge badge-subject">${q.subject}</span>
                                ${q.chapter ? `<span class="badge" style="background: var(--gradient-3);">${q.chapter}</span>` : ''}
                                ${q.type === 'خطأ' ? '<span class="badge badge-error">خطأ</span>' : '<span class="badge badge-important">مهم</span>'}
                                <span class="badge" style="background: ${performanceColor};">المرحلة ${q.reviewStage + 1}</span>
                                <span class="badge" style="background: ${performanceColor};">${performanceLevel}</span>
                                ${q.hasChoices ? '<span class="badge" style="background: var(--warning);">MCQ</span>' : ''}
                            </div>
                            <div class="question-actions">
                                <button class="btn-small btn-note" onclick="openNoteModal('${q.id}')">📝</button>
                                <button class="btn-small btn-danger" onclick="deleteQuestion('${q.id}')">حذف</button>
                            </div>
                        </div>
                        ${imageHTML}
                        ${q.text ? `<div class="question-text">${q.text}</div>` : ''}
                        ${choicesHTML}
                        ${noteHTML}
                        <div class="question-meta">
                            <span>المراجعة القادمة: <strong style="color: ${isOverdue ? 'var(--danger)' : 'var(--success)'};">${nextReviewDate}</strong></span>
                            <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                                ${q.errorCount > 0 ? `<span style="color: var(--danger);">❌ ${q.errorCount} أخطاء</span>` : '<span style="color: var(--success);">✓ بدون أخطاء</span>'}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        }

        function getPerformanceLevel(stage) {
            const levels = ['مبتدئ', 'بداية', 'جيد', 'جيد جداً', 'ممتاز', 'متفوق', 'خبير'];
            return levels[stage] || 'مبتدئ';
        }

        function getPerformanceColor(stage) {
            const colors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981'];
            return colors[Math.min(stage, colors.length - 1)];
        }

        // Notes System
        async function openNoteModal(questionId) {
            if (!currentUser) {
                alert('❌ يجب تسجيل الدخول أولاً');
                return;
            }

            try {
                const doc = await db.collection('questions').doc(questionId).get();
                if (!doc.exists) {
                    alert('❌ السؤال غير موجود');
                    return;
                }

                const question = doc.data();
                currentNoteQuestionId = questionId;
                
                const questionText = question.text || 'صورة السؤال';
                document.getElementById('modalQuestionText').textContent = questionText;
                
                // Load existing note
                if (question.noteType === 'voice' && question.voiceNoteUrl) {
                    switchNoteType('voice');
                    createCustomAudioPlayer(question.voiceNoteUrl, 'customAudioPlayerContainer');
                    document.getElementById('audioPlaybackSection').classList.remove('hidden');
                } else {
                    switchNoteType('text');
                    document.getElementById('noteInput').value = question.note || '';
                }
                
                document.getElementById('noteModal').classList.remove('hidden');
            } catch (error) {
                console.error('Open note modal error:', error);
                alert('❌ حدث خطأ. تأكد من الاتصال بالإنترنت.');
            }
        }

        function closeNoteModal(event) {
            if (event && event.target.id !== 'noteModal') return;
            document.getElementById('noteModal').classList.add('hidden');
            currentNoteQuestionId = null;
            currentVoiceNote = null;
            deleteVoiceNote();
            document.getElementById('noteInput').value = '';
        }

        async function saveNote() {
            if (!currentNoteQuestionId) return;
            if (!currentUser) {
                alert('❌ يجب تسجيل الدخول أولاً');
                return;
            }

            try {
                let updateData = {};

                if (currentNoteType === 'text') {
                    const note = document.getElementById('noteInput').value;
                    updateData = {
                        note: note,
                        noteType: 'text',
                        voiceNoteUrl: ''
                    };
                } else {
                    // Voice note
                    if (!currentVoiceNote) {
                        alert('⚠️ لم يتم تسجيل ملاحظة صوتية');
                        return;
                    }

                    // Convert blob to base64
                    const reader = new FileReader();
                    reader.readAsDataURL(currentVoiceNote);
                    await new Promise((resolve) => {
                        reader.onloadend = () => {
                            updateData = {
                                note: '',
                                noteType: 'voice',
                                voiceNoteUrl: reader.result
                            };
                            resolve();
                        };
                    });
                }

                await db.collection('questions').doc(currentNoteQuestionId).update(updateData);
                closeNoteModal();
                await loadUserData();
                
                const activeTab = document.querySelector('.nav-tab.active, .bottom-nav-item.active');
                if (activeTab && activeTab.textContent.includes('المعرض')) {
                    await loadGallery();
                }
                
                alert('✅ تم حفظ الملاحظة بنجاح');
            } catch (error) {
                console.error('Save note error:', error);
                alert('❌ حدث خطأ أثناء حفظ الملاحظة. تأكد من الاتصال بالإنترنت.');
            }
        }

        // Navigation & Tab Management
        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
            document.querySelectorAll('.nav-tab, .bottom-nav-item').forEach(btn => btn.classList.remove('active'));
            
            const tabEl = document.getElementById(tabName + 'Tab');
            if (tabEl) {
                tabEl.classList.remove('hidden');
            }
            
            event.target.classList.add('active');

            if (tabName === 'gallery') {
                loadGallery();
            } else if (tabName === 'review') {
                loadReviewQuestions();
            } else if (tabName === 'stats') {
                loadDetailedStats();
            } else if (tabName === 'home') {
                loadUserData();
            }
        }

        // Stats Display
        async function loadDetailedStats() {
            const container = document.getElementById('detailedStats');
            container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

            if (!currentUser) {
                container.innerHTML = '<p style="color: var(--danger);">الرجاء تسجيل الدخول</p>';
                return;
            }

            try {
                const snapshot = await db.collection('questions')
                    .where('userId', '==', currentUser.uid)
                    .get();

                const allQuestions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const totalQuestions = allQuestions.length;
                const totalReviewed = allQuestions.filter(q => q.lastReviewed).length;
                const totalErrors = allQuestions.reduce((sum, q) => sum + (q.errorCount || 0), 0);
                const avgErrorCount = totalQuestions > 0 
                    ? (totalErrors / totalQuestions).toFixed(2)
                    : 0;

                const today = new Date();
                today.setHours(23, 59, 59, 999);
                const questionsNeedingReview = allQuestions.filter(q => {
                    if (!q.nextReview) return false;
                    return q.nextReview.toDate() <= today;
                }).length;

                const successRate = totalQuestions > 0 
                    ? (((totalQuestions - allQuestions.filter(q => q.errorCount > 0).length) / totalQuestions) * 100).toFixed(1)
                    : 0;

                const subjects = ['أحياء', 'جيولوجيا', 'كيمياء', 'فيزياء', 'رياضة', 'عربي', 'إنجليزي'];
                const subjectStats = subjects.map(subject => {
                    const subjectQuestions = allQuestions.filter(q => q.subject === subject);
                    return {
                        subject,
                        count: subjectQuestions.length,
                        avgStage: subjectQuestions.length > 0 
                            ? (subjectQuestions.reduce((sum, q) => sum + q.reviewStage, 0) / subjectQuestions.length).toFixed(2)
                            : 0,
                        errorRate: subjectQuestions.length > 0
                            ? (subjectQuestions.filter(q => q.errorCount > 0).length / subjectQuestions.length * 100).toFixed(1)
                            : 0
                    };
                }).filter(s => s.count > 0);

                let html = `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px;">
                        <div style="background: var(--bg-tertiary); padding: 15px; border-radius: 10px;">
                            <div style="font-size: 24px; font-weight: 700; color: var(--accent);">${totalQuestions}</div>
                            <div style="color: var(--text-secondary); font-size: 14px;">إجمالي الأسئلة</div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 15px; border-radius: 10px;">
                            <div style="font-size: 24px; font-weight: 700; color: var(--accent);">${totalReviewed}</div>
                            <div style="color: var(--text-secondary); font-size: 14px;">تمت مراجعتها</div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 15px; border-radius: 10px;">
                            <div style="font-size: 24px; font-weight: 700; color: var(--danger);">${totalErrors}</div>
                            <div style="color: var(--text-secondary); font-size: 14px;">إجمالي الأخطاء</div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 15px; border-radius: 10px;">
                            <div style="font-size: 24px; font-weight: 700; color: var(--success);">${successRate}%</div>
                            <div style="color: var(--text-secondary); font-size: 14px;">معدل النجاح</div>
                        </div>
                    </div>

                    <h4 style="color: var(--accent); margin: 20px 0 15px;">إحصائيات حسب المادة</h4>
                    ${subjectStats.map(s => `
                        <div style="margin-bottom: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 10px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                                <span style="font-weight: 600;">${s.subject}</span>
                                <span style="color: var(--text-secondary); font-size: 14px;">${s.count} سؤال</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px;">
                                <div>
                                    <div style="color: var(--text-secondary);">متوسط المرحلة</div>
                                    <div style="color: var(--accent); font-weight: 600;">${s.avgStage}</div>
                                </div>
                                <div>
                                    <div style="color: var(--text-secondary);">معدل الأخطاء</div>
                                    <div style="color: ${s.errorRate > 30 ? 'var(--danger)' : 'var(--success)'}; font-weight: 600;">${s.errorRate}%</div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                `;

                container.innerHTML = html;
            } catch (error) {
                console.error('Load stats error:', error);
                container.innerHTML = '<p style="color: var(--danger);">❌ حدث خطأ في تحميل الإحصائيات. تأكد من الاتصال بالإنترنت.</p>';
            }
        }

        // Image & OCR Functionality
        function captureImage() {
            document.getElementById('imageInput').click();
        }

        function uploadImage() {
            document.getElementById('uploadInput').click();
        }

        async function processImage(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                const imgElement = document.getElementById('previewImg');
                imgElement.src = e.target.result;
                document.getElementById('imagePreview').classList.remove('hidden');

                const ocrStatus = document.getElementById('ocrStatus');
                ocrStatus.textContent = '⏳ جاري قراءة النص...';

                try {
                    const { data } = await Tesseract.recognize(
                        e.target.result,
                        ['ara', 'eng'],
                        {
                            logger: m => {
                                if (m.status === 'recognizing') {
                                    ocrStatus.textContent = `⏳ ${(m.progress * 100).toFixed(0)}% جاري المعالجة...`;
                                }
                            }
                        }
                    );

                    document.getElementById('questionText').value = data.text.trim();
                    ocrStatus.textContent = '✅ تم استخراج النص بنجاح';
                    ocrStatus.style.color = 'var(--success)';
                } catch (error) {
                    console.error('OCR Error:', error);
                    ocrStatus.textContent = '❌ فشل استخراج النص. أدخل النص يدوياً';
                    ocrStatus.style.color = 'var(--danger)';
                }
            };
            reader.readAsDataURL(file);
        }

        // Notifications
        function requestNotificationPermission() {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        setupSmartNotifications();
                    }
                });
            } else if (Notification.permission === 'granted') {
                setupSmartNotifications();
            }
        }

        function setupSmartNotifications() {
            // Clear existing timers
            notificationTimers.forEach(timer => clearTimeout(timer));
            notificationTimers = [];

            // Schedule notifications for each time slot
            Object.entries(NOTIFICATION_TIMES).forEach(([key, config]) => {
                scheduleNotification(config);
            });
        }

        function scheduleNotification(config) {
            const now = new Date();
            const scheduledTime = new Date();
            scheduledTime.setHours(config.hour, config.minute, 0, 0);

            // If time already passed today, schedule for tomorrow
            if (scheduledTime <= now) {
                scheduledTime.setDate(scheduledTime.getDate() + 1);
            }

            const timeUntilNotification = scheduledTime - now;

            const timer = setTimeout(async () => {
                await sendSmartNotification(config.message);
                // Reschedule for next day
                scheduleNotification(config);
            }, timeUntilNotification);

            notificationTimers.push(timer);
        }

        async function sendSmartNotification(messageTemplate) {
            if (!currentUser) return;
            if (Notification.permission !== 'granted') return;

            try {
                // Get count of questions due today
                const today = new Date();
                today.setHours(23, 59, 59, 999);

                const snapshot = await db.collection('questions')
                    .where('userId', '==', currentUser.uid)
                    .get();

                const dueCount = snapshot.docs.filter(doc => {
                    const data = doc.data();
                    return data.nextReview && data.nextReview.toDate() <= today;
                }).length;

                if (dueCount === 0) return; // Don't send if no questions due

                const countText = dueCount === 1 ? 'سؤال واحد' : `${dueCount} سؤال`;
                const message = messageTemplate.replace('{count}', countText);

                // Check if already sent today
                const lastSentKey = `lastNotification_${message.substring(0, 10)}`;
                const lastSent = localStorage.getItem(lastSentKey);
                const todayStr = new Date().toDateString();

                if (lastSent === todayStr) return;

                new Notification('THANAWEIA AMMA 📚', {
                    body: message,
                    icon: 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Cdefs%3E%3ClinearGradient id=\'grad\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' style=\'stop-color:%23667eea;stop-opacity:1\' /%3E%3Cstop offset=\'100%25\' style=\'stop-color:%23764ba2;stop-opacity:1\' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'100\' height=\'100\' rx=\'20\' fill=\'url(%23grad)\'/%3E%3Ctext x=\'50\' y=\'70\' font-size=\'60\' text-anchor=\'middle\' fill=\'white\' font-family=\'Arial, sans-serif\' font-weight=\'bold\'%3E📚%3C/text%3E%3C/svg%3E',
                    badge: 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Ctext y=\'.9em\' font-size=\'90\'%3E📚%3C/text%3E%3C/svg%3E',
                    tag: 'review-reminder',
                    requireInteraction: false,
                    vibrate: [200, 100, 200]
                });

                localStorage.setItem(lastSentKey, todayStr);
            } catch (error) {
                console.error('Notification error:', error);
            }
        }

        async function checkDailyNotification() {
            if (!currentUser) return;

            // Send immediate notification if questions are overdue
            try {
                const today = new Date();
                today.setHours(23, 59, 59, 999);

                const snapshot = await db.collection('questions')
                    .where('userId', '==', currentUser.uid)
                    .get();

                const overdueCount = snapshot.docs.filter(doc => {
                    const data = doc.data();
                    if (!data.nextReview) return false;
                    const reviewDate = data.nextReview.toDate();
                    reviewDate.setHours(0, 0, 0, 0);
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    return reviewDate < todayStart;
                }).length;

                if (overdueCount > 0 && Notification.permission === 'granted') {
                    const lastOverdueCheck = localStorage.getItem('lastOverdueNotification');
                    const todayStr = new Date().toDateString();

                    if (lastOverdueCheck !== todayStr) {
                        new Notification('تنبيه! ⚠️', {
                            body: `لديك ${overdueCount} ${overdueCount === 1 ? 'سؤال متأخر' : 'أسئلة متأخرة'}!\nراجعهم الآن لتحسين أدائك 💪`,
                            icon: 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Cdefs%3E%3ClinearGradient id=\'grad\' x1=\'0%25\' y1=\'0%25\' x2=\'100%25\' y2=\'100%25\'%3E%3Cstop offset=\'0%25\' style=\'stop-color:%23667eea;stop-opacity:1\' /%3E%3Cstop offset=\'100%25\' style=\'stop-color:%23764ba2;stop-opacity:1\' /%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=\'100\' height=\'100\' rx=\'20\' fill=\'url(%23grad)\'/%3E%3Ctext x=\'50\' y=\'70\' font-size=\'60\' text-anchor=\'middle\' fill=\'white\' font-family=\'Arial, sans-serif\' font-weight=\'bold\'%3E📚%3C/text%3E%3C/svg%3E',
                            tag: 'overdue-warning',
                            requireInteraction: true,
                            vibrate: [300, 100, 300, 100, 300]
                        });

                        localStorage.setItem('lastOverdueNotification', todayStr);
                    }
                }
            } catch (error) {
                console.error('Check overdue error:', error);
            }
        }

        window.addEventListener('load', () => {
            console.log('App initialized - Firestore as Single Source of Truth');
            registerServiceWorker();
        });

        // PWA Installation Functions
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            
            // Check if user hasn't dismissed the prompt before
            const dismissedInstall = localStorage.getItem('dismissedInstall');
            const dismissedDate = localStorage.getItem('dismissedInstallDate');
            const today = new Date().toDateString();
            
            // Show prompt if never dismissed or dismissed more than 3 days ago
            if (!dismissedInstall || dismissedDate !== today) {
                setTimeout(() => {
                    showInstallPrompt();
                }, 3000); // Show after 3 seconds
            }
        });

        window.addEventListener('appinstalled', () => {
            console.log('PWA installed successfully');
            deferredPrompt = null;
            hideInstallPrompt();
            
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('تم التثبيت بنجاح! 🎉', {
                    body: 'يمكنك الآن استخدام التطبيق من الشاشة الرئيسية',
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">📚</text></svg>'
                });
            }
        });

        function showInstallPrompt() {
            const promptEl = document.getElementById('installPrompt');
            if (promptEl && deferredPrompt) {
                promptEl.classList.remove('hidden');
            }
        }

        function hideInstallPrompt() {
            const promptEl = document.getElementById('installPrompt');
            if (promptEl) {
                promptEl.classList.add('hidden');
            }
        }

        async function installApp() {
            if (!deferredPrompt) {
                alert('التطبيق مثبت بالفعل أو المتصفح لا يدعم التثبيت');
                hideInstallPrompt();
                return;
            }

            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            
            console.log(`User response: ${outcome}`);
            
            if (outcome === 'accepted') {
                console.log('User accepted the install prompt');
            } else {
                console.log('User dismissed the install prompt');
            }
            
            deferredPrompt = null;
            hideInstallPrompt();
        }

        function dismissInstallPrompt() {
            hideInstallPrompt();
            localStorage.setItem('dismissedInstall', 'true');
            localStorage.setItem('dismissedInstallDate', new Date().toDateString());
        }

        // Service Worker Registration
        async function registerServiceWorker() {
            if ('serviceWorker' in navigator) {
                try {
                    // Create a simple service worker inline
                    const swCode = `
                        self.addEventListener('install', (e) => {
                            console.log('Service Worker installed');
                            self.skipWaiting();
                        });
                        
                        self.addEventListener('activate', (e) => {
                            console.log('Service Worker activated');
                            e.waitUntil(clients.claim());
                        });
                        
                        self.addEventListener('fetch', (e) => {
                            e.respondWith(
                                fetch(e.request).catch(() => {
                                    return new Response('Offline - please check your connection');
                                })
                            );
                        });
                    `;
                    
                    const blob = new Blob([swCode], { type: 'application/javascript' });
                    const swUrl = URL.createObjectURL(blob);
                    
                    const registration = await navigator.serviceWorker.register(swUrl);
                    console.log('Service Worker registered successfully');
                } catch (error) {
                    console.log('Service Worker registration failed:', error);
                }
            }
        }
