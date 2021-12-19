"""Setup script for python-lint"""

from setuptools import setup  # type: ignore

setup(
    name='python-lint',
    version='0.1.0',
    url='https://github.com/bugale/python-lint',
    license='MIT',
    author='Bugale',
    author_email='bugale@bugalit.com',
    description='An abstraction for running linters on Python code and in repositories',
    packages=['python_lint'],
    include_package_data=True,
    zip_safe=False,
    platforms='any',
    install_requires=['lintly', 'flake8', 'mypy', 'pylint'],
    entry_points={
        'console_scripts': [
            'python-lint = python_lint.cli:main',
        ],
    },
    classifiers=[
        'Development Status :: 5 - Production/Stable',
        'Environment :: Console',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: MIT License',
        'Operating System :: POSIX',
        'Operating System :: MacOS',
        'Operating System :: Unix',
        'Operating System :: Microsoft :: Windows',
        'Programming Language :: Python',
        'Programming Language :: Python :: 3.7',
        'Programming Language :: Python :: 3.8',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
        'Topic :: Software Development :: Libraries :: Python Modules',
        'Topic :: Software Development :: Quality Assurance',
    ]
)
